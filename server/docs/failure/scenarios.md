# Failure scenarios and evidence

Each row is a required scenario. "Evidence" is an automated test that drives the real dependency or the real state machine. A broker stand-in that accepts or refuses a publish is used where the production broker is behind `EventPublisher`. Azure Service Bus and Event Hubs were not interrupted in Azure.

| Scenario | Payment state | Ledger state | Message state | Recovery | Evidence |
| --- | --- | --- | --- | --- | --- |
| Provider timeout / response lost | `AUTHORIZATION_UNKNOWN`, authorized amount stays 0 | No journal | One attempt, status `UNKNOWN` | Status lookup moves the same attempt to `SUCCEEDED` and sets authorized amount once | `apps/payment-service/src/payment.integration.test.ts` |
| Duplicate provider result | Unchanged | Unchanged | Attempt count stays 1 | Second completion is a no-op | same file, `redeliverProviderResult` |
| Duplicate API request | Original payment returned | One capture journal | Idempotency row completed | Same key and body replays; different body is 409 | payment idempotency tests |
| Concurrent capture | One `CAPTURED` | One posting | One winning request | Row lock; seven conflicts | payment concurrency test |
| Ledger posting failure | `CAPTURED`, posting `PENDING` | No journal until retry | Outbox row still written with the capture | `POST /payments/{id}/ledger-postings` posts once | payment ledger-down test |
| Publisher crash after broker accept | Business row committed | — | Outbox returns to `PENDING`, then republishes the same event id | Consumer inbox applies once | `packages/messaging/src/messaging.integration.test.ts` |
| Broker unavailable before accept | Business row committed | — | Nothing sent; outbox stays `PENDING` | Next publish succeeds once | same file |
| Consumer crash before commit | Effect not applied | — | Inbox row rolled back | Redelivery applies the effect | same file |
| Consumer crash after commit | Effect applied once | — | Redelivery is `DUPLICATE` | Ack can be lost safely | same file |
| Malformed or unknown event version | No business write | — | Dead letter, no inbox row | Operator inspects the dead letter | same file |
| Database interruption | In-flight call fails; committed rows remain | Same | — | A new pool reads the committed balance | `packages/database/src/database.integration.test.ts` |
| Duplicate settlement confirmation | Batch stays `CONFIRMED` | — | — | Second confirm is `SETTLEMENT_ALREADY_CONFIRMED` | `apps/settlement-service/src/settlement.integration.test.ts` |
| Same capture in two batches | Second batch rolls back | — | — | Unique `(item_type, source_id)` | same file |
| Reconciliation mismatch | Case `OPEN`, then resolved with a reason | Unchanged (no ledger tables in that database) | — | Re-import of the same file returns the same run and does not open another case | `apps/reconciliation-service/src/reconciliation.integration.test.ts` |
| Redis interruption | No payment or ledger change is possible through Redis | Unchanged | — | Not tested against a Redis client. No service reads Redis. | No automated test. See readiness review. |
| Service Bus or Event Hubs interruption in Azure | — | — | Outbox remains the retry source for the local publisher | Not executed against Azure. The publisher test covers a broker that refuses the send. | Messaging tests; no Azure run |
