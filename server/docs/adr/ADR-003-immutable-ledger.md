# ADR-003: Immutable ledger and reversal-based correction

Status: Accepted
Date: 2026-09-25

## Context

Mistakes happen: a wrong amount is posted, a duplicate command slips through, a fee schedule is
misapplied. The tempting fix is to update or delete the offending rows. In a financial system that
destroys the audit trail and makes historical statements irreproducible — a statement produced
yesterday would no longer match the data today, with no record of why.

## Decision

Posted ledger entries are immutable. There is no update or delete path — not in the repository
layer, not in the database grants, and an `UPDATE`/`DELETE` trigger raises an exception.

Corrections are made by posting a **reversal journal** that mirrors the original (debits and
credits swapped, same amounts, same currency) and references it via `reverses_journal_id`. The
corrected amount, if any, is then posted as a new journal. A journal can be reversed at most once
(`UNIQUE (reverses_journal_id)`).

The only permitted mutation on a posted journal is the single `status: POSTED → REVERSED`
transition, which records that a reversal exists; the entries themselves never change.

## Alternatives considered

- **Update in place.** Fastest, and destroys auditability. Rejected.
- **Soft delete (`deleted_at`).** Still mutates a posted record and creates two truths depending on
  whether a reader filters the flag. Rejected.
- **Versioned entries (new row version supersedes old).** Preserves history but makes every
  balance query version-aware, and "which version was used for last month's settlement" becomes an
  open question. Reversal is the standard accounting answer and is simpler to reason about.

## Trade-offs

- More rows: a correction costs three journals (original, reversal, corrected) instead of one edit.
- Reports must be explicit about whether they include reversed journals.
- Operators must be trained that "fixing" data means posting a reversal, not editing a row.

## Consequences

- History is reproducible: any past statement can be regenerated exactly.
- An attempted update is an alertable security/bug signal (failure scenario F18), not a silent
  success.
- Reconciliation adjustments and settlement reversals all flow through the same mechanism.
- Defence in depth: application layer, database trigger, and role grants each independently
  prevent mutation.
