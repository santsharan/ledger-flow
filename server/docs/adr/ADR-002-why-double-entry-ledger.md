# ADR-002: Why a double-entry ledger

Status: Accepted
Date: 2026-09-25

## Context

A naive payment system stores a `balance` column per merchant and mutates it on each event. That
design cannot answer "why is this balance what it is", cannot detect a lost or duplicated update,
and has no self-check: a wrong balance looks exactly like a right one.

LedgerFlow needs to explain every unit of money: where it came from, what obligation it created,
and where it went.

## Decision

Use double-entry accounting. Every financial movement is a **journal** containing at least two
**ledger entries**, each a DEBIT or CREDIT against an account, all in one currency, where
`SUM(debits) = SUM(credits)`. A journal that does not balance is rejected before any write.

Balances are derived from entries. A materialized `account_balances` row is maintained in the same
transaction as the entries purely as a read optimization and is continuously verified against the
authoritative aggregate.

## Alternatives considered

- **Single mutable balance column.** Simple, fast, and unauditable. A lost update is undetectable.
- **Single-entry transaction log** (append-only list of +/− amounts). Gives history but no
  structural check: nothing forces the counterparty side to exist, so money can appear or vanish.
- **Ledger-as-a-service.** Removes the core demonstration.

## Trade-offs

- More writes per business operation and a more complex domain model.
- Engineers unfamiliar with accounting need the chart of accounts documented (done in
  `docs/architecture/ledger-architecture.md` and `docs/financial-model/double-entry.md`).
- Reporting queries aggregate entries rather than reading a column, hence the materialized
  balances and their verification job.

## Trade-off explicitly accepted

Correctness and explainability over write throughput.

## Consequences

- The balance invariant is machine-checkable at any moment, platform-wide.
- Fees, refunds, chargebacks and settlements all become account movements rather than special
  cases bolted onto a balance field.
- Reconciliation has something precise to reconcile against.
- The chart of accounts becomes a design artifact that must be reviewed when new money flows are
  introduced.
