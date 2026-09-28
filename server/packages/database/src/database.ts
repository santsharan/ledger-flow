import { AsyncLocalStorage } from 'node:async_hooks';
import {
  Pool,
  type PoolClient,
  type PoolConfig,
  type QueryResult as PgQueryResult,
  type QueryResultRow,
} from 'pg';
import { ErrorCode, TransientError } from '@ledgerflow/errors';
import { type Logger } from '@ledgerflow/logger';
import { type Executor, type QueryResult, type TransactionExecutor } from './executor';
import {
  isRetryablePgError,
  mapPgError,
  normalizeDatabaseError,
  type ConstraintErrorMapping,
} from './pg-errors';

export interface DatabaseConfig {
  readonly connectionString: string;
  /**
   * Maximum connections held by this process.
   *
   * `maxConnections × maxReplicas` must fit the server's connection limit, otherwise
   * autoscaling converts a backlog into a database outage (ADR-014).
   */
  readonly maxConnections?: number;
  readonly minConnections?: number;
  readonly idleTimeoutMs?: number;
  readonly connectionTimeoutMs?: number;
  /** Server-side cap so a runaway query cannot hold locks indefinitely. */
  readonly statementTimeoutMs?: number;
  readonly applicationName?: string;
  readonly ssl?: boolean;
}

export type IsolationLevel = 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';

export interface TransactionOptions {
  readonly isolationLevel?: IsolationLevel;
  readonly readOnly?: boolean;
  /**
   * Retries for serialization failures and deadlocks only. A business conflict is never
   * retried — it is a deterministic answer, not a transient fault.
   */
  readonly maxRetries?: number;
  readonly constraintErrors?: readonly ConstraintErrorMapping[];
}

export interface PoolStats {
  readonly total: number;
  readonly idle: number;
  readonly waiting: number;
  readonly max: number;
}

const transactionScope = new AsyncLocalStorage<true>();

/**
 * True while the current async call stack is inside `Database.withTransaction`.
 * Provider calls check this so a network request cannot hide inside a financial transaction.
 */
export function isInDatabaseTransaction(): boolean {
  return transactionScope.getStore() === true;
}

const DEFAULTS = {
  maxConnections: 10,
  minConnections: 0,
  idleTimeoutMs: 30_000,
  connectionTimeoutMs: 5_000,
  statementTimeoutMs: 15_000,
  maxRetries: 2,
} as const;

/**
 * Owns one PostgreSQL connection pool and the transaction semantics built on top of it.
 *
 * External calls never happen inside `withTransaction`: a transaction that waits on a payment
 * provider holds row locks for the duration of someone else's outage (specification §41).
 */
export class Database {
  private readonly pool: Pool;
  private closed = false;

  constructor(
    private readonly config: DatabaseConfig,
    private readonly logger: Logger,
  ) {
    const poolConfig: PoolConfig = {
      connectionString: config.connectionString,
      max: config.maxConnections ?? DEFAULTS.maxConnections,
      min: config.minConnections ?? DEFAULTS.minConnections,
      idleTimeoutMillis: config.idleTimeoutMs ?? DEFAULTS.idleTimeoutMs,
      connectionTimeoutMillis: config.connectionTimeoutMs ?? DEFAULTS.connectionTimeoutMs,
      statement_timeout: config.statementTimeoutMs ?? DEFAULTS.statementTimeoutMs,
      application_name: config.applicationName ?? 'ledgerflow',
      ...(config.ssl === true ? { ssl: { rejectUnauthorized: true } } : {}),
    };

    this.pool = new Pool(poolConfig);

    // An idle client erroring means the server closed the connection — during a failover, for
    // example. The pool discards it; the next acquire opens a fresh one.
    this.pool.on('error', (error) => {
      this.logger.warn({ event: 'database.pool.client_error', err: error }, 'idle client error');
    });
  }

  get stats(): PoolStats {
    return {
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount,
      max: this.config.maxConnections ?? DEFAULTS.maxConnections,
    };
  }

  /** Runs a single statement outside any transaction. */
  async query<TRow extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: readonly unknown[] = [],
    constraintErrors: readonly ConstraintErrorMapping[] = [],
  ): Promise<QueryResult<TRow>> {
    this.assertOpen();

    try {
      return toQueryResult<TRow>(await this.pool.query<TRow>(sql, params as unknown[]));
    } catch (error) {
      throw mapPgError(error, constraintErrors);
    }
  }

  /**
   * Runs `work` inside a transaction, committing on success and rolling back on any throw.
   *
   * On a serialization failure or deadlock the whole callback is retried on a new connection,
   * because a rolled-back transaction has no state to resume.
   */
  async withTransaction<T>(
    work: (tx: TransactionExecutor) => Promise<T>,
    options: TransactionOptions = {},
  ): Promise<T> {
    this.assertOpen();

    const maxRetries = options.maxRetries ?? DEFAULTS.maxRetries;
    let attempt = 0;

    for (;;) {
      attempt += 1;
      const client = await this.acquire();

      try {
        await client.query(buildBeginStatement(options));
        const result = await transactionScope.run(true, () =>
          work(wrapClient(client, options.constraintErrors ?? [])),
        );
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await rollbackQuietly(client, this.logger);

        const retryable = isRetryablePgError(error);
        if (retryable && attempt <= maxRetries) {
          this.logger.warn(
            { event: 'database.transaction.retry', attempt, maxRetries, err: error },
            'retrying transaction after a transient conflict',
          );
          await sleep(backoffMs(attempt));
          continue;
        }

        throw normalizeDatabaseError(error, options.constraintErrors ?? []);
      } finally {
        client.release();
      }
    }
  }

  /** Borrows a connection for work that needs session state, such as advisory locks. */
  async withConnection<T>(work: (executor: Executor) => Promise<T>): Promise<T> {
    this.assertOpen();
    const client = await this.acquire();

    try {
      return await work(wrapClient(client, []));
    } catch (error) {
      throw normalizeDatabaseError(error);
    } finally {
      client.release();
    }
  }

  async ping(): Promise<boolean> {
    const result = await this.query<{ ok: number }>('SELECT 1 AS ok');
    return result.rows[0]?.ok === 1;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.pool.end();
  }

  private async acquire(): Promise<PoolClient> {
    try {
      return await this.pool.connect();
    } catch (error) {
      throw mapPgError(error);
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new TransientError(
        ErrorCode.DATABASE_UNAVAILABLE,
        'The database pool is closed because the service is shutting down.',
      );
    }
  }
}

function wrapClient(
  client: PoolClient,
  constraintErrors: readonly ConstraintErrorMapping[],
): TransactionExecutor {
  return {
    isTransaction: true,
    async query<TRow extends QueryResultRow = QueryResultRow>(
      sql: string,
      params: readonly unknown[] = [],
    ): Promise<QueryResult<TRow>> {
      try {
        return toQueryResult<TRow>(await client.query<TRow>(sql, params as unknown[]));
      } catch (error) {
        throw mapPgError(error, constraintErrors);
      }
    },
  };
}

/**
 * A SQL string containing several statements — a migration file, for example — makes the driver
 * return one result per statement. The last one is the meaningful result for callers.
 */
function toQueryResult<TRow extends QueryResultRow>(
  result: PgQueryResult<TRow> | PgQueryResult<TRow>[],
): QueryResult<TRow> {
  const last = Array.isArray(result) ? result[result.length - 1] : result;

  if (last === undefined) {
    return { rows: [], rowCount: 0 };
  }

  const rows = last.rows ?? [];
  return { rows, rowCount: last.rowCount ?? rows.length };
}

function buildBeginStatement(options: TransactionOptions): string {
  const parts = ['BEGIN'];
  if (options.isolationLevel !== undefined) {
    parts.push(`ISOLATION LEVEL ${options.isolationLevel}`);
  }
  if (options.readOnly === true) {
    parts.push('READ ONLY');
  }
  return parts.join(' ');
}

async function rollbackQuietly(client: PoolClient, logger: Logger): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch (error) {
    // The connection is already broken; the pool discards it on release.
    logger.debug({ event: 'database.rollback.failed', err: error }, 'rollback failed');
  }
}

function backoffMs(attempt: number): number {
  const base = 25 * 2 ** (attempt - 1);
  // Jitter must be random, not deterministic: identical backoff would make competing
  // transactions collide again on every retry.
  // eslint-disable-next-line no-restricted-properties
  return Math.floor(base * (0.5 + Math.random() * 0.5));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
