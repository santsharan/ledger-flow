# ADR-007: Inbox table and idempotency strategy

Status: Accepted
Date: 2026-09-25

## Context

Because publication is at-least-once (ADR-006) and brokers redeliver on consumer crashes, every
consumer will eventually receive the same event twice. If a duplicate `PaymentCaptured` posts a
second ledger journal, the platform has invented money.

The same problem exists at the API edge: a merchant's HTTP client retries a `POST /payments`
after a timeout and must not create a second payment.

## Decision

Idempotency is enforced at two layers, both in PostgreSQL.

**Consumer inbox.** `inbox_events (event_id, consumer, payload_hash, processed_at, created_at)`
with `UNIQUE (event_id, consumer)`. The handler runs inside a transaction that also inserts the
inbox row; a unique violation means the event was already processed and the message is simply
acknowledged. Because the inbox insert and the business effect share one transaction, a crash
either applies both or neither — including a crash after commit but before the broker ack (F11).

**API idempotency keys.** `idempotency_keys (scope, key, operation, request_hash, status,
response, created_at, expires_at)` with `UNIQUE (scope, key)`, where `scope` is the acting
merchant/actor so keys cannot collide or be squatted across tenants.

| Case | Result |
| --- | --- |
| New key | Reserved in the business transaction, response stored on completion |
| Same key, same request hash, completed | Original response replayed |
| Same key, same request hash, in progress | `409 IDEMPOTENT_REQUEST_IN_PROGRESS` |
| Same key, different request hash | `409 IDEMPOTENCY_KEY_CONFLICT` |

**Natural idempotency.** Where a natural business key exists it is preferred over bookkeeping:
`journals UNIQUE (reference_type, reference_id)` means a redelivered posting command returns the
existing journal instead of creating a second one.

Redis may cache idempotent responses for latency, but financial correctness never depends on it.

## Alternatives considered

- **Broker-level deduplication only** (Service Bus duplicate detection, Kafka idempotent producer).
  Microsoft documents duplicate detection as a configurable *history window*; outside that window
  duplicates pass through, and it protects the producer path rather than the business effect.
  Useful as a cheap first filter, insufficient as the guarantee.
- **Application-memory dedupe cache.** Lost on restart, not shared across replicas.
- **Redis-only dedupe.** Eviction and failover can drop keys; that is an availability store, not a
  correctness store.
- **Make every handler naturally idempotent and skip the inbox.** Ideal where possible and used
  where a natural key exists, but not all handlers have one.

## Trade-offs

- An extra write per consumed message and per API mutation.
- Inbox and idempotency tables need retention/cleanup jobs; key expiry must exceed realistic client
  and provider retry windows.
- A key held by an in-flight request produces a `409` that clients must handle by retrying later.

## Consequences

- Duplicate delivery and duplicate API calls cannot produce duplicate financial effects.
- The platform claims **exactly-once effect**, not exactly-once delivery, and says so explicitly.
- Every consumer is testable against duplicate, out-of-order and crash-redelivery scenarios
  (F9–F11).
