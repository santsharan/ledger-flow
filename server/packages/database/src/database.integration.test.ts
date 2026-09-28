import { AppError, ErrorCode } from '@ledgerflow/errors';
import { Money } from '@ledgerflow/money';
import { silentLogger, startPostgres, type PostgresFixture } from '@ledgerflow/test-utils';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Database } from './database';
import { DatabaseHealthIndicator } from './database-health';
import { moneyParam, toMoney } from './row-mapping';

let fixture: PostgresFixture;
let database: Database;

beforeAll(async () => {
  fixture = await startPostgres();
  database = new Database(
    { connectionString: fixture.connectionString, maxConnections: 8, statementTimeoutMs: 5_000 },
    silentLogger(),
  );

  await database.query(`
    CREATE TABLE accounts (
      id            text PRIMARY KEY,
      balance_minor bigint NOT NULL DEFAULT 0,
      currency      char(3) NOT NULL,
      CONSTRAINT accounts_balance_non_negative CHECK (balance_minor >= 0)
    )
  `);
  await database.query(`
    CREATE TABLE idempotency_keys (
      scope text NOT NULL,
      key   text NOT NULL,
      CONSTRAINT idempotency_keys_scope_key_unique UNIQUE (scope, key)
    )
  `);
}, 180_000);

afterAll(async () => {
  await database.close();
  await fixture.stop();
});

beforeEach(async () => {
  await database.query('TRUNCATE accounts, idempotency_keys');
});

describe('transactions', () => {
  it('commits all writes together', async () => {
    await database.withTransaction(async (tx) => {
      await tx.query('INSERT INTO accounts (id, balance_minor, currency) VALUES ($1, $2, $3)', [
        'acc-1',
        moneyParam(Money.of(100_000, 'INR')),
        'INR',
      ]);
      await tx.query('INSERT INTO accounts (id, balance_minor, currency) VALUES ($1, $2, $3)', [
        'acc-2',
        moneyParam(Money.of(50_000, 'INR')),
        'INR',
      ]);
    });

    const result = await database.query<{ id: string; balance_minor: string; currency: string }>(
      'SELECT id, balance_minor, currency FROM accounts ORDER BY id',
    );

    expect(result.rowCount).toBe(2);
    expect(toMoney(result.rows[0]!.balance_minor, result.rows[0]!.currency).amountMinor).toBe(
      100_000n,
    );
  });

  it('rolls back every write when the callback throws', async () => {
    await expect(
      database.withTransaction(async (tx) => {
        await tx.query('INSERT INTO accounts (id, balance_minor, currency) VALUES ($1, 1, $2)', [
          'acc-rollback',
          'INR',
        ]);
        throw new Error('business rule failed after the insert');
      }),
    ).rejects.toThrow();

    const result = await database.query('SELECT id FROM accounts');
    expect(result.rowCount).toBe(0);
  });

  it('rolls back when a constraint fires mid-transaction', async () => {
    await expect(
      database.withTransaction(async (tx) => {
        await tx.query('INSERT INTO accounts (id, balance_minor, currency) VALUES ($1, 10, $2)', [
          'acc-check',
          'INR',
        ]);
        // Violates accounts_balance_non_negative.
        await tx.query('UPDATE accounts SET balance_minor = -1 WHERE id = $1', ['acc-check']);
      }),
    ).rejects.toMatchObject({ code: ErrorCode.CHECK_VIOLATION });

    const result = await database.query('SELECT id FROM accounts');
    expect(result.rowCount).toBe(0);
  });

  it('does not leak connections across failed transactions', async () => {
    for (let i = 0; i < 20; i += 1) {
      await expect(
        database.withTransaction(async (tx) => {
          await tx.query('SELECT 1');
          throw new Error('fail');
        }),
      ).rejects.toThrow();
    }

    expect(database.stats.total).toBeLessThanOrEqual(database.stats.max);
    await expect(database.ping()).resolves.toBe(true);
  });

  it('honours READ ONLY transactions', async () => {
    await expect(
      database.withTransaction(
        async (tx) => {
          await tx.query('INSERT INTO accounts (id, balance_minor, currency) VALUES ($1, 1, $2)', [
            'acc-ro',
            'INR',
          ]);
        },
        { readOnly: true },
      ),
    ).rejects.toThrow();
  });
});

describe('error mapping', () => {
  it('maps a unique violation to a business conflict', async () => {
    await database.query('INSERT INTO idempotency_keys (scope, key) VALUES ($1, $2)', [
      'merchant-1',
      'key-1',
    ]);

    const error = await database
      .query('INSERT INTO idempotency_keys (scope, key) VALUES ($1, $2)', ['merchant-1', 'key-1'])
      .catch((caught: unknown) => caught);

    expect(AppError.isAppError(error)).toBe(true);
    const appError = error as AppError;
    expect(appError.code).toBe(ErrorCode.UNIQUE_VIOLATION);
    expect(appError.httpStatus).toBe(409);
    expect(appError.category).toBe('BUSINESS_CONFLICT');
    expect(appError.isRetryable).toBe(false);
    expect(appError.details).toMatchObject({ constraint: 'idempotency_keys_scope_key_unique' });
  });

  it('maps a named constraint to a domain-specific error', async () => {
    await database.query('INSERT INTO idempotency_keys (scope, key) VALUES ($1, $2)', ['m', 'k']);

    const error = await database
      .query(
        'INSERT INTO idempotency_keys (scope, key) VALUES ($1, $2)',
        ['m', 'k'],
        [
          {
            constraint: 'idempotency_keys_scope_key_unique',
            error: () =>
              new AppError({
                code: ErrorCode.IDEMPOTENCY_KEY_CONFLICT,
                message: 'This idempotency key was already used.',
                httpStatus: 409,
                category: 'BUSINESS_CONFLICT',
              }),
          },
        ],
      )
      .catch((caught: unknown) => caught);

    expect((error as AppError).code).toBe(ErrorCode.IDEMPOTENCY_KEY_CONFLICT);
  });

  it('never exposes SQL text to callers', async () => {
    const error = await captureError(() =>
      database.query('SELECT * FROM table_that_does_not_exist'),
    );

    expect(error.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(error.message).not.toContain('table_that_does_not_exist');
  });

  it('maps a statement timeout to a transient error', async () => {
    const shortTimeout = new Database(
      { connectionString: fixture.connectionString, statementTimeoutMs: 200, maxConnections: 2 },
      silentLogger(),
    );

    try {
      const error = await captureError(() => shortTimeout.query('SELECT pg_sleep(2)'));

      expect(error.code).toBe(ErrorCode.DATABASE_TIMEOUT);
      expect(error.isRetryable).toBe(true);
    } finally {
      await shortTimeout.close();
    }
  });

  it('refuses to run once the pool is closed', async () => {
    const closing = new Database(
      { connectionString: fixture.connectionString, maxConnections: 1 },
      silentLogger(),
    );
    await closing.close();

    await expect(closing.query('SELECT 1')).rejects.toMatchObject({
      code: ErrorCode.DATABASE_UNAVAILABLE,
    });
  });
});

describe('concurrency', () => {
  it('serializes competing row updates with FOR UPDATE', async () => {
    await database.query(
      'INSERT INTO accounts (id, balance_minor, currency) VALUES ($1, 100, $2)',
      ['acc-lock', 'INR'],
    );

    // Ten concurrent debits of 10 against a balance of 100: all ten must succeed and the
    // final balance must be exactly zero — no lost updates.
    const debits = Array.from({ length: 10 }, () =>
      database.withTransaction(async (tx) => {
        const current = await tx.query<{ balance_minor: string }>(
          'SELECT balance_minor FROM accounts WHERE id = $1 FOR UPDATE',
          ['acc-lock'],
        );
        const balance = BigInt(current.rows[0]!.balance_minor);
        await tx.query('UPDATE accounts SET balance_minor = $1 WHERE id = $2', [
          (balance - 10n).toString(),
          'acc-lock',
        ]);
      }),
    );

    await Promise.all(debits);

    const result = await database.query<{ balance_minor: string }>(
      'SELECT balance_minor FROM accounts WHERE id = $1',
      ['acc-lock'],
    );
    expect(BigInt(result.rows[0]!.balance_minor)).toBe(0n);
  });

  it('lets exactly one of two competing inserts win', async () => {
    const attempts = Array.from({ length: 5 }, () =>
      database
        .query('INSERT INTO idempotency_keys (scope, key) VALUES ($1, $2)', ['race', 'same-key'])
        .then(() => 'won' as const)
        .catch(() => 'lost' as const),
    );

    const outcomes = await Promise.all(attempts);
    expect(outcomes.filter((outcome) => outcome === 'won')).toHaveLength(1);
  });

  it('retries a deadlock and completes', async () => {
    await database.query(
      'INSERT INTO accounts (id, balance_minor, currency) VALUES ($1, 100, $2), ($3, 100, $2)',
      ['acc-a', 'INR', 'acc-b'],
    );

    // Two transactions touching the same rows in opposite order deadlock; PostgreSQL aborts
    // one, and the retry in withTransaction completes it (failure-model.md F3).
    const forward = database.withTransaction(async (tx) => {
      await tx.query('SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE', ['acc-a']);
      await sleep(150);
      await tx.query('SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE', ['acc-b']);
    });

    const reverse = database.withTransaction(async (tx) => {
      await tx.query('SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE', ['acc-b']);
      await sleep(150);
      await tx.query('SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE', ['acc-a']);
    });

    await expect(Promise.all([forward, reverse])).resolves.toBeDefined();
  });
});

describe('connection loss', () => {
  it('keeps committed rows after the pool is closed and a new pool reconnects', async () => {
    await database.query(
      'INSERT INTO accounts (id, balance_minor, currency) VALUES ($1, 42, $2)',
      ['acc-reconnect', 'INR'],
    );

    await database.close();

    await expect(database.query('SELECT 1')).rejects.toMatchObject({
      code: ErrorCode.DATABASE_UNAVAILABLE,
    });

    const recovered = new Database({ connectionString: fixture.connectionString }, silentLogger());
    try {
      const row = await recovered.query<{ balance_minor: string }>(
        'SELECT balance_minor FROM accounts WHERE id = $1',
        ['acc-reconnect'],
      );
      expect(row.rows[0]?.balance_minor).toBe('42');
    } finally {
      database = recovered;
    }
  });
});

describe('health', () => {
  it('reports up when the pool is usable', async () => {
    const indicator = new DatabaseHealthIndicator(database);

    await expect(indicator.check()).resolves.toEqual({ status: 'up' });
  });

  it('reports down when the database is gone', async () => {
    const unreachable = new Database(
      {
        connectionString: 'postgres://nobody:nobody@127.0.0.1:1/nothing',
        connectionTimeoutMs: 500,
        maxConnections: 1,
      },
      silentLogger(),
    );

    try {
      const result = await new DatabaseHealthIndicator(unreachable).check();
      expect(result.status).toBe('down');
    } finally {
      await unreachable.close();
    }
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Runs an operation that is expected to fail and returns the typed error it threw. */
async function captureError(operation: () => Promise<unknown>): Promise<AppError> {
  try {
    await operation();
  } catch (error) {
    if (AppError.isAppError(error)) return error;
    throw error;
  }
  throw new Error('Expected the operation to fail.');
}
