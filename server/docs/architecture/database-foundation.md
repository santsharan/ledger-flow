# Database Foundation

> Implemented in `packages/database`. Decisions: [ADR-001](../adr/ADR-001-why-postgresql.md),
> [ADR-013](../adr/ADR-013-azure-postgresql-flexible-server.md).

## Components

| Piece | Responsibility |
| --- | --- |
| `Database` | Owns one pool; exposes `query`, `withTransaction`, `withConnection`, `ping`, `stats` |
| `Executor` | Anything that can run SQL — the pool, or a client inside a transaction |
| `Migrator` | Forward-only versioned migrations with checksums and an advisory lock |
| `pg-errors` | SQLSTATE → typed application error |
| `row-mapping` | `bigint` and `Money` conversion at the repository boundary |
| `DatabaseHealthIndicator` | Readiness check including pool saturation |

## Transactions

```ts
await database.withTransaction(async (tx) => {
  const payment = await paymentRepository.lockById(tx, paymentId);
  await paymentRepository.markCaptured(tx, payment);
  await outboxRepository.append(tx, paymentCapturedEvent);
});
```

Repositories take an `Executor`, which is what allows several repository calls to share one
transaction. That is the mechanism behind the platform's core guarantee: state change, ledger
posting and outbox row commit together or not at all (specification §14).

### What must never appear inside a transaction

```ts
// Never. The lock is held for the duration of someone else's outage.
await database.withTransaction(async (tx) => {
  await tx.query('SELECT … FOR UPDATE');
  await acquirer.authorize(request);   // <- external network call
});
```

Provider calls happen between transactions: persist intent, commit, call the provider, then
record the result in a second transaction ([payment lifecycle §4](payment-lifecycle.md)).

### Retries

`withTransaction` retries only serialization failures (40001), deadlocks (40P01) and lock-timeout
conditions, with exponential backoff and full jitter. A business conflict is never retried — it is
a deterministic answer, not a transient fault. Retrying re-runs the whole callback on a fresh
connection, because a rolled-back transaction has no state to resume from.

### Isolation

`READ COMMITTED` is the default, with explicit `SELECT … FOR UPDATE` row locks where an invariant
spans a read and a write (capture amount checks, balance updates). `REPEATABLE READ` and
`SERIALIZABLE` are available per transaction where a multi-row snapshot must be stable. Locks are
always acquired in a deterministic order — sorted by account id — so concurrent journals cannot
deadlock in opposite directions.

## Error mapping

| SQLSTATE | Application error | Category | Retried |
| --- | --- | --- | --- |
| 23505 unique violation | `UNIQUE_VIOLATION` (or a mapped domain error) | BUSINESS_CONFLICT | no |
| 23503 foreign key | `FOREIGN_KEY_VIOLATION` | BUSINESS_CONFLICT | no |
| 23514 / 23502 check, not null | `CHECK_VIOLATION` | BUSINESS_CONFLICT | no |
| 40001 serialization failure | `SERIALIZATION_FAILURE` | TRANSIENT | yes |
| 40P01 deadlock | `DATABASE_DEADLOCK` | TRANSIENT | yes |
| 55P03 lock not available | `DATABASE_TIMEOUT` | TRANSIENT | yes |
| 57014 statement timeout | `DATABASE_TIMEOUT` | TRANSIENT | yes |
| 53300 / 57P0x / connection errors | `DATABASE_UNAVAILABLE` | TRANSIENT | yes |
| anything else | `INTERNAL_ERROR` | PERMANENT | no |

Unrecognised errors are deliberately flattened so table names, SQL text and driver messages never
reach a client (specification §34). Callers may map a **named constraint** to a specific business
error, which is how `idempotency_keys_scope_key_unique` becomes `IDEMPOTENCY_KEY_CONFLICT`
instead of a generic conflict.

Errors thrown by the callback itself pass through untouched: a domain error that aborts a
transaction must keep its meaning.

## Pooling

| Setting | Default | Reason |
| --- | --- | --- |
| `maxConnections` | 10 | `max × replicas` must fit the server limit (ADR-014) |
| `connectionTimeoutMs` | 5 000 | Fail fast rather than queue indefinitely |
| `idleTimeoutMs` | 30 000 | Release connections during quiet periods |
| `statementTimeoutMs` | 15 000 | A runaway query cannot hold locks forever |

Readiness reports `down` when the pool is saturated with waiting acquirers, so an instance that
cannot serve requests stops receiving them (failure-model.md F2). Idle-client errors — which is
what a managed failover looks like — are logged and the connection discarded; the next acquire
opens a fresh one.

## Migrations

- Files are named `<version>_<name>.sql`, applied in version order, each in its own transaction.
- Every applied migration is recorded with a SHA-256 checksum. Editing a file that already ran
  makes the runner refuse to start, because the database would no longer match the file. A
  correction is a new migration — the same reasoning as ledger reversals (ADR-003).
- A session-level advisory lock is taken **before** the bookkeeping table is created, so two pods
  starting simultaneously cannot race in the system catalogue.
- Forward-only. There is no automatic `down` migration: an automated rollback of a destructive
  change on financial data is more dangerous than a deliberate forward fix.

## Testing

Integration tests run against real PostgreSQL through Testcontainers — constraints, row locks,
deadlock detection and isolation only exist in the real engine. The suite covers commit and
rollback, mid-transaction constraint failures, connection leaks across failures, unique-violation
mapping, statement timeouts, competing `FOR UPDATE` updates, a genuine deadlock with retry, and
concurrent migrators.
