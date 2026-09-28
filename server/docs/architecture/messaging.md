# Messaging

> Implemented in `packages/events` and `packages/messaging`. Wired into payment capture,
> authorization and refund: the outbox row commits in the same transaction as the state change.

## Delivery claim

Publication is at-least-once. A publisher crash after the broker accepts a message and before
`published_at` is written leaves the row pending, so a restart publishes it again. Consumers
insert `inbox_events (event_id, consumer)` in the same transaction as the business effect, so
the duplicate does not apply twice.

This is not exactly-once delivery.

## Crash behaviour covered by tests

| Scenario | Result |
| --- | --- |
| Business commit, publisher crashes after the broker accepts | Outbox row stays pending; the business row remains |
| Publisher restarts | The same event id is published again, then marked published |
| Claim left in `PUBLISHING` by a dead process | `recoverStuck` returns it to pending |
| Duplicate delivery | Inbox returns `DUPLICATE` and does not reapply the effect |
| Consumer throws before commit | Inbox row rolls back; a retry applies the effect |
| Consumer commits, then the message is redelivered | Second delivery is a duplicate |
| Malformed envelope or payload | Dead-lettered, no inbox row, no business effect |
| Unsupported event version | Dead-lettered with `UNSUPPORTED_EVENT_VERSION` |

## Broker adapter

`EventPublisher` is the only broker type domain code sees. `KafkaBroker` is the local adapter
(topic key = aggregate id). Azure Service Bus and Event Hubs implement the same interface in
later infrastructure phases. Domain services do not import Kafka types.
