# ADR-006: Transactional outbox for event publication

Status: Accepted
Date: 2026-09-25

## Context

A captured payment must both change database state and inform the rest of the platform. Writing to
the database and publishing to a broker are two separate systems, and there is no atomic commit
across them.

- Publish first, then commit: the event can describe a transaction that was rolled back.
- Commit first, then publish: a crash between the two loses the event permanently.

Neither is acceptable for financial workflows, and a distributed transaction across PostgreSQL and
a broker is explicitly out of scope.

## Decision

Implement the transactional outbox pattern. The event row is inserted into `outbox_events` in the
**same database transaction** as the business change. A separate publisher process claims unpublished
rows (`FOR UPDATE SKIP LOCKED`), publishes to the broker, and marks them published after the broker
acknowledges.

Rules:

- No external event is ever published before its transaction commits.
- Publication is at-least-once. A crash after the broker ack but before marking the row published
  results in a duplicate publish — which is safe because consumers are idempotent (ADR-007).
- Publisher failures use exponential backoff with `attempt_count` and `next_attempt_at`; rows never
  disappear.
- Outbox backlog is a first-class metric (`outbox_backlog`) with an alert, because a growing
  backlog means the rest of the platform is diverging from the ledger.

## Alternatives considered

- **Direct publish inside the transaction.** The failure modes above; also holds a database
  transaction open across a network call, which ADR-013/pooling guidance forbids.
- **Change Data Capture (Debezium on the WAL).** Genuinely good and avoids a polling publisher, but
  adds Kafka Connect infrastructure and couples the event shape to the table shape. The outbox
  table lets the *event contract* be designed independently of storage. Documented as a future
  option.
- **Two-phase commit between PostgreSQL and the broker.** Operationally fragile, poor broker
  support, and explicitly ruled out by the architecture principles.
- **Best-effort publish with reconciliation cleanup.** Pushes a solved problem onto operators.

## Trade-offs

- Publication latency equals the polling interval (configurable; a `LISTEN/NOTIFY` nudge can cut
  it), so events are near-real-time rather than instantaneous.
- Extra table, extra process, extra retention/cleanup policy.
- Duplicates are guaranteed to happen eventually, which forces consumer idempotency — a cost, but
  one that also makes redelivery and replay safe.

## Consequences

- The ledger and the event stream cannot diverge due to a crash; the worst case is delay.
- Outbox rows are the real recovery source for replay, independent of broker retention.
- The publisher must be crash-tested explicitly (failure scenarios F7, F12).
- The platform states at-least-once delivery honestly and never claims exactly-once.
