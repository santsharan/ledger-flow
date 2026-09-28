# Architecture Decision Records

Each ADR records Context, Decision, Alternatives considered, Trade-offs and Consequences.
ADRs are immutable once accepted: a changed decision is a new ADR that supersedes the old one.

| ADR | Title | Status |
| --- | --- | --- |
| [ADR-001](ADR-001-why-postgresql.md) | Why PostgreSQL as the financial source of truth | Accepted |
| [ADR-002](ADR-002-why-double-entry-ledger.md) | Why a double-entry ledger | Accepted |
| [ADR-003](ADR-003-immutable-ledger.md) | Immutable ledger and reversal-based correction | Accepted |
| [ADR-004](ADR-004-payment-state-machine.md) | Explicit payment state machine | Accepted |
| [ADR-005](ADR-005-external-provider-unknown-state.md) | Explicit unknown states for external operations | Accepted |
| [ADR-006](ADR-006-transactional-outbox.md) | Transactional outbox for event publication | Accepted |
| [ADR-007](ADR-007-inbox-idempotency.md) | Inbox table and idempotency strategy | Accepted |
| [ADR-008](ADR-008-service-bus-vs-event-hubs.md) | Service Bus for commands, Event Hubs for streams | Accepted |
| [ADR-009](ADR-009-reconciliation-architecture.md) | Reconciliation as a first-class capability | Accepted |
| [ADR-010](ADR-010-settlement-architecture.md) | Settlement snapshots over recomputation | Accepted |
| [ADR-011](ADR-011-workload-identity.md) | Workload Identity over static credentials | Accepted |
| [ADR-012](ADR-012-private-networking.md) | Private networking for all data services | Accepted |
| [ADR-013](ADR-013-azure-postgresql-flexible-server.md) | Azure Database for PostgreSQL Flexible Server | Accepted |
| [ADR-014](ADR-014-autoscaling.md) | HPA for APIs, KEDA for workers | Accepted |
| [ADR-015](ADR-015-audit-architecture.md) | Append-only audit separate from business state | Accepted |
| [ADR-016](ADR-016-money-representation.md) | Integer minor units for money | Accepted |
| [ADR-017](ADR-017-monorepo-and-runtime.md) | pnpm monorepo, NestJS on Fastify | Accepted |

## Template

```markdown
# ADR-NNN: Title

Status: Proposed | Accepted | Superseded by ADR-XXX
Date: YYYY-MM-DD

## Context
## Decision
## Alternatives considered
## Trade-offs
## Consequences
```
