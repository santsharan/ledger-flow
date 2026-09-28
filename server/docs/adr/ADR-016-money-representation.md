# ADR-016: Integer minor units for money

Status: Accepted
Date: 2026-09-25

## Context

`0.1 + 0.2 !== 0.3` in IEEE-754 double precision, which is what a JavaScript `number` is. A
payments platform that stores or computes money as a floating-point value will, given enough
transactions, produce balances that are wrong by fractions of a unit — and a ledger that is wrong
by 0.01 is simply wrong.

JavaScript numbers are also only exact integers up to 2^53−1, which is large but not unbounded,
and JSON has no native decimal or big-integer type.

## Decision

Money is represented as **integer minor units plus an ISO 4217 currency code**:
`₹10.50` is `{ amountMinor: 1050, currency: "INR" }`, never `10.50`.

`packages/money` provides a `Money` value object with:

- Construction only from safe integers (or strings for large values); constructing from a
  non-integer throws.
- `add`, `subtract`, `multiply` (by integer), `allocate` (remainder-preserving split), `compare`,
  `equals`, `isZero`, `isNegative`.
- **Currency mismatch throws** — there is no silent conversion. Cross-currency movement, if ever
  added, must be an explicit domain operation with an exchange rate and an audit trail.
- Currency metadata drives the exponent (INR/USD = 2, JPY = 0, KWD = 3) so formatting and parsing
  are not hardcoded to 2 decimals.
- Serialization is `{ amountMinor: string, currency: string }` over the wire: a **string** for the
  amount, so a large `bigint` survives JSON without precision loss and without assuming the
  consumer supports BigInt.

Storage uses `bigint` columns for minor units with `CHECK` constraints on sign where appropriate.
No `float`, `double`, `real` or `numeric`-as-float column ever holds money.

`bigint` is used in TypeScript for arithmetic so intermediate results (e.g. `gross × bps`) cannot
silently exceed the safe-integer range.

## Alternatives considered

- **Floating-point numbers.** Wrong by construction. Rejected.
- **decimal.js / big.js.** Correct, but introduces an arbitrary-precision decimal where the domain
  genuinely is integral — money exists in indivisible minor units — and invites accidental
  fractional amounts.
- **PostgreSQL `NUMERIC` with a decimal library.** Correct in the database, but the application
  boundary still needs a safe type, and it permits fractional minor units that have no meaning.
- **Number of minor units as a plain JS `number`.** Safe up to 2^53−1 minor units, which is
  enormous, but offers no protection against an intermediate multiplication overflowing.

## Trade-offs

- `bigint` does not serialize to JSON natively, so every boundary needs explicit conversion — this
  is enforced by the `Money` codec rather than left to each service.
- Developers must think in minor units; the API contract documents this prominently and the type
  system makes a bare number unusable as money.
- Percentage fees need an explicit, documented rounding rule (ADR-010) rather than "just multiply".

## Consequences

- Floating-point money is structurally impossible in the codebase, and a lint rule plus code review
  guards against a bare `number` being used as an amount.
- Currency mismatches fail loudly at the type/runtime boundary instead of producing a wrong total.
- Rounding decisions are explicit, versioned and testable.
