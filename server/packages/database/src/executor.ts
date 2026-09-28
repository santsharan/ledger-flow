import { type QueryResultRow } from 'pg';

export interface QueryResult<TRow extends QueryResultRow> {
  readonly rows: TRow[];
  readonly rowCount: number;
}

/**
 * Anything that can run SQL: the pool, or a client inside a transaction.
 *
 * Repositories take an `Executor` rather than a pool, which is what lets a service compose
 * several repository calls into one transaction — the property that makes "update payment,
 * post journal, write outbox row" atomic (specification §14).
 */
export interface Executor {
  query<TRow extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<TRow>>;
}

/** An executor that is known to be inside a transaction. */
export interface TransactionExecutor extends Executor {
  readonly isTransaction: true;
}
