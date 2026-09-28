# Failure Model

> Status: Phase 0. Every row becomes an automated scenario in Phase 15.

## 1. Failure philosophy

1. The ledger must never be corrupted by an external failure.
2. Ambiguity is a first-class state, not an error to be retried away.
3. At-least-once delivery plus idempotent business processing. The platform does **not** claim
   exactly-once delivery; it claims **exactly-once financial effect**, enforced by database
   constraints.
4. Every failure has a named recovery mechanism and an operator-visible signal.

## 2. Failure classification

| Class | Examples | Handling |
| --- | --- | --- |
| Transient | connection reset, 503, lock timeout, broker unavailable | Retry with exponential backoff + jitter, bounded attempts |
| Ambiguous | provider timeout, response lost after send | Move to `*_UNKNOWN`, resolve by status lookup — never blind retry |
| Permanent | provider declined, validation failure, schema mismatch | No retry; dead-letter or terminal state |
| Business conflict | capture exceeds authorization, duplicate idempotency key with different body | Deterministic typed error, HTTP 409/422 |
| Auth failure | expired or invalid token, missing permission | No repeated retry; alert if systemic |

## 3. Scenario matrix

| # | Failure | Expected state | Recovery mechanism | Operator visibility |
| --- | --- | --- | --- | --- |
| F1 | PostgreSQL unavailable | Request fails with 503, no partial write | Pool retry, readiness probe fails, pod removed from rotation | `database_pool_usage`, DB error rate alert |
| F2 | PostgreSQL connection exhaustion | Requests queue then fail fast | Bounded pool + acquire timeout; HPA does not multiply pressure without pool limits | Pool saturation alert |
| F3 | Deadlock | Transaction aborts (40P01), retried once | Deterministic lock ordering by account ID; retry-on-serialization-failure helper | `database_deadlock_total` |
| F4 | Provider timeout | Attempt `UNKNOWN`, payment `AUTHORIZATION_UNKNOWN` | Status reconciler | `payment_provider_timeout_total`, unknown-count alert |
| F5 | Provider success, response lost | Same as F4; **no second charge** | Status lookup keyed by attempt ID | Unknown-state dashboard |
| F6 | Provider duplicate response | Second response ignored | Attempt result write is conditional on current attempt status | `provider_duplicate_response_total` |
| F7 | Broker unavailable (Kafka/Service Bus) | Business transaction still commits; outbox rows accumulate | Outbox publisher retries; backlog drains on recovery | `outbox_backlog` alert |
| F8 | Event Hubs unavailable | Analytics/event stream lags | Outbox retention covers the gap | Backlog + publish-failure metrics |
| F9 | Duplicate message delivery | Handler runs at most once in business terms | `inbox_events UNIQUE (event_id, consumer)` | `message_duplicate_total` |
| F10 | Consumer crash before acknowledgement | Message redelivered | Inbox dedupe makes reprocessing safe | Consumer lag |
| F11 | Consumer crash after DB commit, before ack | Message redelivered, inbox says already processed, ack only | Inbox row is committed in the same transaction as the effect | Consumer lag |
| F12 | Outbox publisher crash mid-publish | Event may be published twice, never lost | Publisher marks `published_at` after broker ack; consumers dedupe | `outbox_publish_failures` |
| F13 | Concurrent capture (20 parallel) | Exactly one capture succeeds | `SELECT ... FOR UPDATE` on the payment row + amount invariant | `payment_conflict_total` |
| F14 | Concurrent refund | Sum of refunds never exceeds captured | Row lock + `CHECK (refunded_minor <= captured_minor)` | Same |
| F15 | Duplicate API request (same key) | Original response replayed | Idempotency table unique constraint | `idempotency_replay_total` |
| F16 | Same key, different body | 409 `IDEMPOTENCY_KEY_CONFLICT` | Request hash comparison | `idempotency_conflict_total` |
| F17 | Invalid ledger posting (unbalanced) | Rejected before write, nothing persisted | Application validation + verification query | `ledger_journal_failures_total`, unbalanced-attempt alert |
| F18 | Attempt to update/delete a posted entry | Database exception | Trigger + missing grant | Audit + alert (indicates a bug or an intrusion) |
| F19 | Redis unavailable | Degraded performance, correctness unaffected | Cache bypass path; rate limiting fails open or closed per endpoint policy (documented) | Cache error rate |
| F20 | Partial settlement | Batch stuck in `SUBMITTED`/`SETTLEMENT_UNKNOWN` | Status lookup + operator approval | Settlement failure alert |
| F21 | Duplicate settlement confirmation | Second confirmation is a no-op | Unique confirmation constraint + ledger reference uniqueness | `settlement_duplicate_confirm_total` |
| F22 | Reconciliation mismatch | Case opened, no auto-fix | Operator workflow | Mismatch spike alert |
| F23 | Malformed event payload | Message dead-lettered without consumption side effects | Envelope + payload schema validation before handling | DLQ count |
| F24 | Incompatible event version | Dead-lettered with `UNSUPPORTED_EVENT_VERSION` | Versioned contracts; consumers declare supported range | DLQ by error code |
| F25 | Pod terminated mid-processing (SIGTERM) | In-flight work finishes or is abandoned unacknowledged | Graceful shutdown order; never ack before commit | Deployment events |

## 4. Retry policy

| Parameter | Value |
| --- | --- |
| Base delay | 200 ms |
| Multiplier | 2 |
| Jitter | full jitter |
| Max attempts (transient, sync) | 3 |
| Max attempts (async worker) | 5, then dead-letter |
| Max delay | 30 s |
| Non-retryable | validation, authorization, business conflict, ambiguous-outcome |

Ambiguous outcomes are explicitly **not** retried: a retry after an unknown authorization can
create a second financial effect. They go to the status-lookup path instead.

## 5. Dead-letter workflow

Recorded per dead-lettered message: `eventId`, `messageId`, `consumer`, `errorCode`,
`errorMessage`, `attemptCount`, `firstFailureAt`, `lastFailureAt`, `originalPayload`.

Operator flow: inspect → approve replay (explicit, per message or per selected batch) → replay →
mark resolved. There is deliberately **no** "replay everything" endpoint, because a blind bulk
replay of financial messages is how duplicate effects get created at scale.

## 6. Graceful shutdown order

```
SIGTERM
 → fail readiness probe (stop new traffic)
 → stop message consumption (no new leases)
 → let in-flight handlers finish, bounded by terminationGracePeriod
 → settle/abandon messages: ack only what is committed, abandon the rest
 → flush telemetry
 → close broker clients
 → close Redis
 → drain and close PostgreSQL pool
 → close HTTP server
 → exit 0
```

## 7. What the platform explicitly does not guarantee

- No exactly-once *delivery* — only exactly-once *effect* via idempotency keys, inbox rows and
  unique constraints.
- No cross-service atomicity — there is no two-phase commit; workflows are compensating.
- No automatic correction of financial discrepancies — resolution is a human-approved workflow.
- No cross-region failover in the initial deployment.
