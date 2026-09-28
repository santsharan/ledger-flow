# ADR-010: Settlement snapshots over recomputation

Status: Accepted
Date: 2026-09-25

## Context

A settlement says: "for this merchant, for this date, in this currency, we owe this net amount,
and here is the arithmetic." The inputs — captures, refunds, chargebacks, fees, adjustments —
keep changing after the settlement window closes. A refund issued tomorrow changes today's
payment rows.

If a settlement is recomputed on demand from current payment data, last week's settlement report
will not reproduce the amount that was actually paid out, and nobody will be able to explain the
difference.

## Decision

Settlement is computed once and frozen:

- `settlement_items` capture the exact input rows (type, source, signed amount, occurrence time).
- `settlement_snapshots` store the fee schedule *version and content* used, the window boundaries,
  the totals, and an `input_digest` (SHA-256 over the ordered item tuples).
- `settlement_batches` store the resulting `gross`, `fees`, `refunds`, `chargebacks`,
  `adjustments`, `net` as integer minor units.

`net = gross − refunds − chargebacks − fees + adjustments`, all integer arithmetic, single
currency per batch. Fee rounding is an explicit, versioned rule, so changing the fee schedule
never retroactively changes a historical settlement.

Recalculating from the stored items must reproduce the stored digest and totals — this is asserted
by a test.

The lifecycle is an explicit state machine (`CREATED → CALCULATING → CALCULATED → APPROVED →
SUBMITTED → CONFIRMED`, plus `SETTLEMENT_UNKNOWN`, `FAILED`, `REVERSED`) where every transition
writes an audit row, `CONFIRMED` is protected against double confirmation, and the ledger posting
is idempotent through `UNIQUE (reference_type, reference_id)`.

## Alternatives considered

- **Recompute on read.** Simple until the first refund; then historical reports silently change.
- **Store only the totals.** Reproduces the number but not the reasoning; a disputed settlement
  cannot be explained line by line.
- **Derive settlements directly from ledger entries at query time.** The ledger is authoritative
  for movement, but settlement also depends on fee schedules and approval decisions that are not
  ledger facts.

## Trade-offs

- Storage grows with item-level detail.
- An item included in a closed batch cannot be retroactively removed; late corrections become
  adjustments in a later batch, which is the accounting-correct behaviour but requires operators
  to understand it.
- Two sources of the same number (snapshot totals and item sum) must be kept consistent, hence the
  digest check.

## Consequences

- Any past settlement is explainable and reproducible from stored data alone.
- Fee schedule changes are safe.
- Settlement cannot exceed the merchant's available payable balance (checked against the ledger
  before approval).
- Duplicate settlement confirmation and duplicate ledger posting are structurally prevented.
