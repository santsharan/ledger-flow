import { AppError, ErrorCode } from '@ledgerflow/errors';
import { getCurrency, type Currency } from './currency';

/**
 * Minor units are stored in PostgreSQL `bigint` columns, so the representable range is the
 * signed 64-bit range. Exceeding it is rejected at construction rather than silently wrapping
 * or failing later at the database boundary.
 */
export const MAX_MINOR = 9_223_372_036_854_775_807n;
export const MIN_MINOR = -9_223_372_036_854_775_808n;

export class InvalidMoneyAmountError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super({
      code: ErrorCode.INVALID_MONEY_AMOUNT,
      message,
      httpStatus: 400,
      category: 'PERMANENT',
      ...(details === undefined ? {} : { details }),
    });
  }
}

export class CurrencyMismatchError extends AppError {
  constructor(left: string, right: string) {
    super({
      code: ErrorCode.CURRENCY_MISMATCH,
      message: `Cannot combine ${left} with ${right}. Currency conversion must be an explicit operation.`,
      httpStatus: 400,
      category: 'PERMANENT',
      details: { left, right },
    });
  }
}

/** Wire representation: the amount is a string so a 64-bit value survives JSON intact. */
export interface MoneyJSON {
  readonly amountMinor: string;
  readonly currency: string;
}

export type RoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'FLOOR' | 'CEIL';

export type MoneyInput = bigint | number | string;

/**
 * An amount of money as integer minor units plus a currency (ADR-016).
 *
 * `Money` is immutable and has no floating-point path: every constructor rejects a
 * non-integer, and every operation is bigint arithmetic.
 */
export class Money {
  private constructor(
    readonly amountMinor: bigint,
    readonly currency: Currency,
  ) {}

  // ---------------------------------------------------------------- construction

  /** Builds from minor units: `Money.of(1050, 'INR')` is ₹10.50. */
  static of(amountMinor: MoneyInput, currencyCode: string): Money {
    const currency = getCurrency(currencyCode);
    return new Money(toMinorBigInt(amountMinor), currency);
  }

  static zero(currencyCode: string): Money {
    return new Money(0n, getCurrency(currencyCode));
  }

  /**
   * Parses a decimal string such as "10.50" using string manipulation only.
   *
   * Deliberately takes a string and not a number: `Money.fromDecimal(0.1 + 0.2, 'INR')` would
   * already have lost precision before this function was called.
   */
  static fromDecimalString(value: string, currencyCode: string): Money {
    const currency = getCurrency(currencyCode);
    const trimmed = value.trim();
    const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(trimmed);

    if (match === null) {
      throw new InvalidMoneyAmountError(`"${value}" is not a valid decimal amount.`, {
        value,
        currency: currency.code,
      });
    }

    const [, sign, whole = '0', fraction = ''] = match;

    if (fraction.length > currency.exponent) {
      throw new InvalidMoneyAmountError(
        `${currency.code} has ${currency.exponent} minor digits; "${value}" has ${fraction.length}.`,
        { value, currency: currency.code, exponent: currency.exponent },
      );
    }

    const padded = fraction.padEnd(currency.exponent, '0');
    const minor = BigInt(`${sign ?? ''}${whole}${padded}`);

    return new Money(assertInRange(minor), currency);
  }

  static fromJSON(json: MoneyJSON): Money {
    return Money.of(json.amountMinor, json.currency);
  }

  // ---------------------------------------------------------------- arithmetic

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(assertInRange(this.amountMinor + other.amountMinor), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(assertInRange(this.amountMinor - other.amountMinor), this.currency);
  }

  negate(): Money {
    return new Money(assertInRange(-this.amountMinor), this.currency);
  }

  abs(): Money {
    return this.amountMinor < 0n ? this.negate() : this;
  }

  /** Multiplies by a whole number — quantities, not rates. Rates go through `applyRate`. */
  multiply(factor: bigint | number): Money {
    return new Money(assertInRange(this.amountMinor * toMinorBigInt(factor)), this.currency);
  }

  /**
   * Applies a rate expressed in basis points (1 bps = 0.01%), which is how fee schedules are
   * defined. Rounding is explicit because a fee rounded differently is a different fee
   * (ADR-010).
   */
  applyRate(basisPoints: bigint | number, rounding: RoundingMode = 'HALF_UP'): Money {
    const bps = toMinorBigInt(basisPoints);
    return new Money(
      assertInRange(divideRounded(this.amountMinor * bps, 10_000n, rounding)),
      this.currency,
    );
  }

  /**
   * Splits an amount into parts weighted by `weights`, preserving every minor unit.
   *
   * The remainder is handed out one unit at a time, largest fractional part first, so
   * `sum(allocate(...)) === original` always holds — no unit is lost to rounding.
   */
  allocate(weights: readonly (bigint | number)[]): Money[] {
    if (weights.length === 0) {
      throw new InvalidMoneyAmountError('Allocation requires at least one weight.');
    }

    const bigWeights = weights.map((weight) => toMinorBigInt(weight));
    if (bigWeights.some((weight) => weight < 0n)) {
      throw new InvalidMoneyAmountError('Allocation weights must not be negative.');
    }

    const total = bigWeights.reduce((sum, weight) => sum + weight, 0n);
    if (total === 0n) {
      throw new InvalidMoneyAmountError('Allocation weights must not sum to zero.');
    }

    const negative = this.amountMinor < 0n;
    const magnitude = negative ? -this.amountMinor : this.amountMinor;

    const shares = bigWeights.map((weight) => (magnitude * weight) / total);
    const remainders = bigWeights.map((weight, index) => ({
      index,
      remainder: magnitude * weight - shares[index]! * total,
    }));

    let leftover = magnitude - shares.reduce((sum, share) => sum + share, 0n);

    // Ties break towards the earlier index, which keeps allocation deterministic and therefore
    // reproducible in settlement snapshots.
    remainders.sort((a, b) =>
      a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
    );

    for (const { index } of remainders) {
      if (leftover <= 0n) break;
      shares[index] = shares[index]! + 1n;
      leftover -= 1n;
    }

    return shares.map((share) => new Money(negative ? -share : share, this.currency));
  }

  // ---------------------------------------------------------------- comparison

  compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    if (this.amountMinor < other.amountMinor) return -1;
    if (this.amountMinor > other.amountMinor) return 1;
    return 0;
  }

  equals(other: Money): boolean {
    return this.currency.code === other.currency.code && this.amountMinor === other.amountMinor;
  }

  greaterThan(other: Money): boolean {
    return this.compare(other) === 1;
  }

  greaterThanOrEqual(other: Money): boolean {
    return this.compare(other) >= 0;
  }

  lessThan(other: Money): boolean {
    return this.compare(other) === -1;
  }

  lessThanOrEqual(other: Money): boolean {
    return this.compare(other) <= 0;
  }

  get isZero(): boolean {
    return this.amountMinor === 0n;
  }

  get isPositive(): boolean {
    return this.amountMinor > 0n;
  }

  get isNegative(): boolean {
    return this.amountMinor < 0n;
  }

  // ---------------------------------------------------------------- serialization

  toJSON(): MoneyJSON {
    return { amountMinor: this.amountMinor.toString(), currency: this.currency.code };
  }

  /** Decimal representation built from digits, never from a floating-point division. */
  toDecimalString(): string {
    const negative = this.amountMinor < 0n;
    const digits = (negative ? -this.amountMinor : this.amountMinor).toString();

    if (this.currency.exponent === 0) {
      return `${negative ? '-' : ''}${digits}`;
    }

    const padded = digits.padStart(this.currency.exponent + 1, '0');
    const whole = padded.slice(0, -this.currency.exponent);
    const fraction = padded.slice(-this.currency.exponent);

    return `${negative ? '-' : ''}${whole}.${fraction}`;
  }

  toString(): string {
    return `${this.currency.code} ${this.toDecimalString()}`;
  }

  // ---------------------------------------------------------------- helpers

  static sum(amounts: readonly Money[], currencyCode?: string): Money {
    if (amounts.length === 0) {
      if (currencyCode === undefined) {
        throw new InvalidMoneyAmountError('Summing an empty list requires an explicit currency.');
      }
      return Money.zero(currencyCode);
    }

    return amounts.reduce((total, amount) => total.add(amount));
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency.code !== other.currency.code) {
      throw new CurrencyMismatchError(this.currency.code, other.currency.code);
    }
  }
}

function toMinorBigInt(value: MoneyInput): bigint {
  if (typeof value === 'bigint') {
    return assertInRange(value);
  }

  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new InvalidMoneyAmountError(
        `Money requires integer minor units; received ${value}. Use Money.fromDecimalString for decimal input.`,
        { value },
      );
    }
    if (!Number.isSafeInteger(value)) {
      throw new InvalidMoneyAmountError(
        `${value} exceeds the safe integer range; pass a bigint or string instead.`,
        { value },
      );
    }
    return assertInRange(BigInt(value));
  }

  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new InvalidMoneyAmountError(`"${value}" is not an integer minor-unit amount.`, { value });
  }

  return assertInRange(BigInt(trimmed));
}

function assertInRange(value: bigint): bigint {
  if (value > MAX_MINOR || value < MIN_MINOR) {
    throw new InvalidMoneyAmountError(
      'Amount is outside the representable 64-bit minor-unit range.',
      { value: value.toString() },
    );
  }
  return value;
}

function divideRounded(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator - quotient * denominator;

  if (remainder === 0n) {
    return quotient;
  }

  const negative = numerator < 0n !== denominator < 0n;
  const twiceRemainder = (remainder < 0n ? -remainder : remainder) * 2n;
  const absDenominator = denominator < 0n ? -denominator : denominator;

  switch (mode) {
    case 'FLOOR':
      return negative ? quotient - 1n : quotient;
    case 'CEIL':
      return negative ? quotient : quotient + 1n;
    case 'HALF_UP':
      if (twiceRemainder >= absDenominator) {
        return negative ? quotient - 1n : quotient + 1n;
      }
      return quotient;
    case 'HALF_EVEN':
      if (twiceRemainder > absDenominator) {
        return negative ? quotient - 1n : quotient + 1n;
      }
      if (twiceRemainder === absDenominator && quotient % 2n !== 0n) {
        return negative ? quotient - 1n : quotient + 1n;
      }
      return quotient;
  }
}
