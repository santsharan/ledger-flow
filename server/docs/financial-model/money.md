# Money

> Implemented in `packages/money`. Decision recorded in [ADR-016](../adr/ADR-016-money-representation.md).

## The rule

Money is **integer minor units plus an ISO 4217 currency**. There is no floating-point path
anywhere in the platform.

```ts
Money.of(1050, 'INR');              // ₹10.50
Money.fromDecimalString('10.50', 'INR');
Money.of(10.5, 'INR');              // throws InvalidMoneyAmountError
```

`Money.of(10.5, …)` throwing is the point: a fractional minor unit has no meaning, and accepting
one would let a rounding error enter the ledger silently.

## Why not a float

`0.1 + 0.2 === 0.30000000000000004`. A JavaScript `number` is an IEEE-754 double, so every
decimal amount is an approximation. Approximations accumulate, and a ledger that is wrong by one
paise is wrong.

Minor units also match how payment networks and acquirers actually transmit amounts, so there is
no conversion at the boundary.

## Currency is data, not a constant

| Currency | Exponent | 1 unit |
| --- | --- | --- |
| INR, USD, EUR, GBP, SGD, AED, AUD | 2 | 100 minor units |
| JPY | 0 | 1 minor unit |
| KWD, BHD | 3 | 1000 minor units |

Hardcoding "divide by 100" breaks JPY and KWD. The exponent comes from the currency record, which
is why `Money.fromDecimalString('10.5', 'JPY')` is rejected while `'1.234'` is valid for KWD.

## Currency mismatch is an error, never a conversion

```ts
Money.of(1000, 'INR').add(Money.of(1000, 'USD'));  // throws CurrencyMismatchError
```

Silent conversion would mean an invented exchange rate inside an arithmetic operator. If
conversion is ever added it must be an explicit domain operation carrying a rate, a timestamp and
an audit trail.

## Arithmetic

| Operation | Notes |
| --- | --- |
| `add`, `subtract` | Same currency required; result range-checked |
| `negate`, `abs` | |
| `multiply(n)` | Whole quantities only — `multiply(1.5)` throws |
| `applyRate(bps, rounding)` | Rates in basis points, with an explicit rounding mode |
| `allocate(weights)` | Splits an amount without losing a minor unit |
| `compare`, `equals`, `lessThan`, … | Same currency required |

### Rounding is explicit

`applyRate` takes `HALF_UP` (default), `HALF_EVEN`, `FLOOR` or `CEIL`. A fee rounded differently
is a different fee, so the mode is part of the fee schedule and is recorded in the settlement
snapshot ([ADR-010](../adr/ADR-010-settlement-architecture.md)).

```ts
Money.of(100000, 'INR').applyRate(250);  // 2.5% of ₹1,000.00 = ₹25.00
```

### Allocation preserves every unit

Splitting ₹100.01 three ways cannot be done evenly. `allocate` distributes the remainder one unit
at a time, largest fractional part first, with ties broken by index so the result is
deterministic:

```ts
Money.of(10001, 'INR').allocate([1, 1, 1]);  // 3334, 3334, 3333 — sums to 10001
```

## Range

Minor units are stored in PostgreSQL `bigint` columns, so values are bounded by the signed 64-bit
range. Construction and every arithmetic result are range-checked, so an overflow throws instead
of wrapping or failing later at the database boundary.

## Serialization

Over the wire the amount is a **string**:

```json
{ "amountMinor": "1050", "currency": "INR" }
```

JSON has no 64-bit integer type, and `JSON.stringify` cannot serialize a `bigint` at all. A string
survives any consumer, including ones without BigInt support, with no precision loss.

At the database boundary, `node-postgres` returns `bigint` columns as strings; `toMoney` and
`moneyParam` in `packages/database` make the conversion explicit rather than letting a `Number`
cast creep in.

## Guardrails

- `@typescript-eslint` plus a `no-restricted-globals` rule ban `parseFloat` repository-wide.
- No money value is typed as `number` in any domain model; `Money` is the only carrier.
- 32 unit tests cover construction, parsing, arithmetic, overflow, rounding modes, allocation,
  comparison and serialization, including the `0.1 + 0.2` case.
