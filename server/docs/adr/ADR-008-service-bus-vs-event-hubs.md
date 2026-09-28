# ADR-008: Service Bus for commands, Event Hubs for streams, Kafka locally

Status: Accepted
Date: 2026-09-25

## Context

The platform has two different messaging needs that are often conflated:

1. **Workflow commands** — "authorize this payment", "calculate this settlement". Low volume, must
   not be lost, need per-message retry, per-message failure isolation and a dead-letter path.
2. **Domain event streams** — payment/ledger/audit/risk facts. High volume, partitioned, replayable
   by offset, consumed by many independent readers including analytics.

A single broker choice forces a compromise: queue semantics make high-volume streaming expensive,
while log semantics make per-message dead-lettering awkward.

Local development must also work without Azure.

## Decision

- **Azure Service Bus** for workflow commands and jobs: peek-lock, per-message retry,
  dead-letter queues, sessions where ordering is required.
- **Azure Event Hubs** for domain event streams: partitioned by `merchantId` or `paymentId`
  depending on the ordering requirement, with consumer groups and offset-based replay.
- **Apache Kafka locally** for both roles, with topic naming that mirrors the Azure split.
- **`packages/messaging`** exposes `CommandBus`, `EventPublisher` and `EventConsumer` interfaces.
  Domain and application layers depend only on these; broker SDK types never leak upward. Adapters
  are selected by configuration.

Peek-lock is chosen for commands because message loss is unacceptable: if a consumer dies, the
lock expires and the message is redelivered. Service Bus duplicate detection may be enabled as an
optimization, but it is a configurable history window, **not** a replacement for application-level
idempotency (ADR-007).

## Alternatives considered

- **Kafka everywhere, including Azure** (self-managed or Confluent Cloud). Uniform mental model,
  but self-managing Kafka on AKS is real operational work, and per-message DLQ/retry semantics
  have to be hand-built.
- **Service Bus only.** Fine for commands; costly and awkward for high-volume streams and replay.
- **Event Hubs only.** Fine for streams; no native per-message dead-lettering or lock renewal.
- **No abstraction, direct SDK use.** Faster to write, but couples domain code to a broker and
  makes local development require Azure.

## Trade-offs

- Two broker technologies in production, plus an abstraction layer to maintain.
- The abstraction must expose enough (lock renewal, dead-lettering, partition keys) to be useful
  without becoming a lowest-common-denominator API that hides important semantics.
- Local Kafka behaviour is not identical to Service Bus; integration tests run on Kafka, and the
  Azure adapters need their own contract tests.

## Consequences

- Each messaging need uses a broker suited to it, and the reasoning is explicit rather than
  incidental.
- Local development and CI run entirely on Docker.
- Partition-key choice becomes a design decision per stream and is documented with the event
  contract.
- The platform never describes broker deduplication as exactly-once delivery.
