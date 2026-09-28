# ADR-015: Append-only audit separate from business state

Status: Accepted
Date: 2026-09-25

## Context

"Who changed this, when, and why" must be answerable for every financially significant action —
approving a settlement, resolving a reconciliation case, overriding a risk decision, refunding a
payment. Application logs are unsuitable as the answer: they are sampled, rotated, mutable by
whoever controls the logging stack, and not queryable as business records.

Audit is also conceptually different from business state. A payment's current status is business
state; the fact that a specific operator approved a settlement at a specific time for a stated
reason is an audit fact that must survive even if the business row is later corrected.

## Decision

Maintain an append-only audit model, written in the **same transaction** as the business change so
an audited action cannot exist without its audit record.

Fields: `auditId`, `actorType`, `actorId`, `action`, `resourceType`, `resourceId`, `beforeState`,
`afterState`, `reason`, `ipAddress` (where appropriate), `requestId`, `correlationId`, `traceId`,
`createdAt`.

Rules:

- **Append-only.** No `UPDATE`/`DELETE` grants; a trigger rejects mutation.
- **Business fields only** in `beforeState`/`afterState`. Never passwords, access tokens, refresh
  tokens, API keys, payment secrets or full payment payloads.
- **Redaction at the writer**, structurally (field allowlist/denylist), not by regex over strings.
- Audit lives in the owning service's database (so it shares the business transaction) and is
  additionally streamed to a durable analytics/event sink for long-term retention.
- Manual actions that change a case or settlement state require `actor`, `reason`, `previousState`
  and `newState`; there is no code path that changes such state without them.
- Audit is distinct from the domain **events** in `outbox_events`: events are integration facts for
  other services, audit is an operator/compliance record. They are produced together but serve
  different consumers and have different retention.

## Alternatives considered

- **Structured application logs as the audit trail.** Mutable, sampled, not transactional with the
  change. Fine for debugging, not for compliance.
- **Database-level auditing (triggers capturing every row change).** Captures mechanics without
  intent: it records that a column changed, not who decided it or why.
- **Event stream as the only audit trail.** Broker retention is finite, and events are designed for
  integration consumers rather than for "show me everything this operator did".
- **A central audit service written to over HTTP.** Breaks transactional atomicity with the change
  it audits; a failed call would produce unaudited actions.

## Trade-offs

- Audit rows grow quickly and need a retention/archival policy.
- Writing audit in the business transaction adds write cost to the hot path.
- Keeping audit in each service's database means cross-service audit queries require the streamed
  copy rather than a join.

## Consequences

- Every financially significant action is traceable to an actor, a reason and a correlation ID.
- A single correlation ID follows a request across API, command, payment, ledger, event,
  settlement and reconciliation.
- Audit tampering requires database-level privilege escalation, which is itself alertable.
- Reconciliation case resolutions and settlement approvals are provably attributable.
