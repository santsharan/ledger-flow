# ADR-001: Why PostgreSQL as the financial source of truth

Status: Accepted
Date: 2026-09-25

## Context

LedgerFlow records money movement. The core operation — post a balanced journal, advance a payment
state, and record an outgoing event — must be atomic. If any part of it can be observed partially
applied, the ledger can report money that does not exist.

The platform also needs multi-row invariants (capture ≤ authorization, refund ≤ capture, unique
idempotency keys, one journal per reference) that must hold under concurrency, and it needs the
ability to lock specific rows while competing requests are in flight.

## Decision

PostgreSQL is the single source of truth for all financial state, one logical database per bounded
context. All financial state changes happen inside a single-database ACID transaction. Constraints
(`UNIQUE`, `CHECK`, foreign keys, triggers) enforce invariants at the storage layer so a bug in
application code cannot produce an impossible financial state.

Redis is a cache and rate-limiting store only. Kafka/Service Bus/Event Hubs carry derived facts.
Neither is ever consulted to decide what is financially true.

## Alternatives considered

- **MongoDB / document store.** Multi-document transactions exist but the data model here is
  fundamentally relational (accounts ↔ journals ↔ entries), and the invariants are multi-row
  constraints that a document store cannot enforce declaratively.
- **Event sourcing as the primary store.** Attractive for auditability, but rebuilding balances
  from an event log makes "what is this merchant's payable balance right now, under concurrency"
  an application concern rather than a database guarantee. The immutable journal already gives
  the audit property without the projection-lag problem.
- **A ledger SaaS.** Hides exactly the engineering this project exists to demonstrate.
- **Multiple stores with distributed transactions (XA / sagas across databases).** Rejected; see
  ADR-006. Distributed transactions across services are explicitly out of scope.

## Trade-offs

- Single-writer-per-context scaling ceiling; sharding by merchant would be needed at very high
  volume. Acceptable and documented rather than pre-solved.
- Relational schema changes need disciplined migrations and rolling-deploy compatibility.
- PostgreSQL becomes a critical availability dependency, mitigated by zone-redundant HA (ADR-013).

## Consequences

- Every service owns its own database and never reads another's (see bounded-contexts).
- Integration tests run against real PostgreSQL via Testcontainers, not mocks.
- Financial correctness tests can assert at the SQL level (`SUM(debits) = SUM(credits)`).
- Deadlock and connection-exhaustion handling must be explicit parts of the database layer.
