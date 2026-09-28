# ADR-009: Reconciliation as a first-class capability

Status: Accepted
Date: 2026-09-25

## Context

Every real payment platform eventually disagrees with its acquirer: a settlement file shows a
different amount, a transaction is missing, a duplicate appears, a status differs. Systems that
treat this as an occasional support ticket accumulate silent financial drift.

Reconciliation is also the recovery mechanism for the unknown states introduced in ADR-005.

## Decision

Reconciliation is a dedicated bounded context with its own database, pipeline and operator API:

`import → normalize → match → classify → open cases → metrics/alerts`

- Imports are idempotent on `(provider, file_digest)`; rows on `(import_id, row_digest)`.
- Matching is a documented, ordered, deterministic rule hierarchy (provider reference, payment
  reference, amount + currency + date, and an explicitly-disabled-by-default tolerance rule). The
  matching reason is stored with every match.
- Ambiguity is never guessed: a many-to-many group is classified as `DUPLICATE_EXTERNAL` /
  `DUPLICATE_INTERNAL` rather than matched arbitrarily.
- Every non-matched record produces a typed result and an auditable case with its own state
  machine (`OPEN → INVESTIGATING → RESOLVED | ESCALATED | IGNORED_WITH_REASON`).
- **Reconciliation never silently modifies financial records.** Any correction is an explicit,
  approved adjustment posted as a ledger journal referencing the case ID.

## Alternatives considered

- **Manual spreadsheet reconciliation.** The industry default and exactly what this project argues
  against: unauditable, unrepeatable, unscalable.
- **Auto-correcting engine** that adjusts internal records to match the statement. Dangerous: it
  would hide provider errors and make fraud invisible.
- **Fuzzy/ML matching from the start.** Non-deterministic results in a financial audit trail are a
  liability; the interface allows a scoring engine later, disabled by default.
- **Reconciliation embedded in payment-service.** Couples an operational workflow with different
  scaling and access patterns to the transaction hot path.

## Trade-offs

- Cases require human operators; the platform optimizes for correct escalation rather than
  automatic closure.
- Read-only cross-context queries to payment and ledger services add coupling, mitigated by
  keeping them strictly read-only and API-based.
- Deterministic matching will leave some genuinely-matched pairs unmatched (e.g. provider changed a
  reference format), producing false-positive cases. Accepted: a false case is investigated; a
  false match is undetected drift.

## Consequences

- Financial discrepancies are detected on a schedule, classified, and owned.
- `AUTHORIZATION_UNKNOWN` and friends have a concrete resolution path.
- Every manual action carries actor, timestamp, reason, previous state and new state.
- The reconciliation demo (internal 10000 vs external 9900 → `AMOUNT_MISMATCH` → case → resolution)
  is reproducible on demand.
