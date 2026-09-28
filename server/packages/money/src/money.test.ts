import { describe, expect, it } from 'vitest';
import {
  CurrencyMismatchError,
  InvalidMoneyAmountError,
  MAX_MINOR,
  Money,
  UnsupportedCurrencyError,
} from './index';

describe('Money construction', () => {
  it('builds from integer minor units', () => {
    const money = Money.of(1050, 'INR');

    expect(money.amountMinor).toBe(1050n);
    expect(money.currency.code).toBe('INR');
    expect(money.toDecimalString()).toBe('10.50');
    expect(money.toString()).toBe('INR 10.50');
  });

  it('accepts bigint and string minor units', () => {
    expect(Money.of(9_007_199_254_740_993n, 'INR').amountMinor).toBe(9_007_199_254_740_993n);
    expect(Money.of('123456789012345678', 'INR').amountMinor).toBe(123456789012345678n);
  });

  it('rejects a fractional number — money is never a float (ADR-016)', () => {
    expect(() => Money.of(10.5, 'INR')).toThrow(InvalidMoneyAmountError);
    expect(() => Money.of(0.1 + 0.2, 'INR')).toThrow(InvalidMoneyAmountError);
  });

  it('rejects a number beyond the safe integer range', () => {
    expect(() => Money.of(Number.MAX_SAFE_INTEGER + 2, 'INR')).toThrow(InvalidMoneyAmountError);
  });

  it('rejects amounts beyond the 64-bit storage range', () => {
    expect(() => Money.of(MAX_MINOR + 1n, 'INR')).toThrow(InvalidMoneyAmountError);
    expect(Money.of(MAX_MINOR, 'INR').amountMinor).toBe(MAX_MINOR);
  });

  it('rejects a non-numeric string', () => {
    expect(() => Money.of('10.50', 'INR')).toThrow(InvalidMoneyAmountError);
    expect(() => Money.of('abc', 'INR')).toThrow(InvalidMoneyAmountError);
    expect(() => Money.of('', 'INR')).toThrow(InvalidMoneyAmountError);
  });

  it('rejects an unsupported currency', () => {
    expect(() => Money.of(100, 'XYZ')).toThrow(UnsupportedCurrencyError);
  });
});

describe('Money.fromDecimalString', () => {
  it('parses decimal strings by digits, not by floating point', () => {
    expect(Money.fromDecimalString('10.50', 'INR').amountMinor).toBe(1050n);
    expect(Money.fromDecimalString('0.01', 'INR').amountMinor).toBe(1n);
    expect(Money.fromDecimalString('1000', 'INR').amountMinor).toBe(100000n);
    expect(Money.fromDecimalString('-25.99', 'USD').amountMinor).toBe(-2599n);
  });

  it('honours the currency exponent', () => {
    expect(Money.fromDecimalString('1000', 'JPY').amountMinor).toBe(1000n);
    expect(Money.fromDecimalString('1.234', 'KWD').amountMinor).toBe(1234n);
  });

  it('rejects more precision than the currency has', () => {
    expect(() => Money.fromDecimalString('10.501', 'INR')).toThrow(InvalidMoneyAmountError);
    expect(() => Money.fromDecimalString('10.5', 'JPY')).toThrow(InvalidMoneyAmountError);
  });

  it('rejects malformed input', () => {
    for (const value of ['', '.', '1.2.3', '1e5', 'ten', '1,000.00', ' 1 0 ']) {
      expect(() => Money.fromDecimalString(value, 'INR')).toThrow(InvalidMoneyAmountError);
    }
  });

  it('round-trips through the decimal representation', () => {
    for (const value of ['0.00', '0.01', '10.50', '-3.07', '999999.99']) {
      expect(Money.fromDecimalString(value, 'INR').toDecimalString()).toBe(value);
    }
  });
});

describe('Money arithmetic', () => {
  it('adds and subtracts exactly where floating point would not', () => {
    const tenPaise = Money.of(10, 'INR');
    const twentyPaise = Money.of(20, 'INR');

    expect(tenPaise.add(twentyPaise).amountMinor).toBe(30n);
    expect(Money.of(30, 'INR').subtract(twentyPaise).amountMinor).toBe(10n);

    // The canonical floating-point failure, in minor units.
    const accumulated = Array.from({ length: 10 }).reduce<Money>(
      (total) => total.add(Money.of(1, 'INR')),
      Money.zero('INR'),
    );
    expect(accumulated.amountMinor).toBe(10n);
  });

  it('refuses to mix currencies', () => {
    const rupees = Money.of(1000, 'INR');
    const dollars = Money.of(1000, 'USD');

    expect(() => rupees.add(dollars)).toThrow(CurrencyMismatchError);
    expect(() => rupees.subtract(dollars)).toThrow(CurrencyMismatchError);
    expect(() => rupees.compare(dollars)).toThrow(CurrencyMismatchError);
    expect(rupees.equals(dollars)).toBe(false);
  });

  it('negates and takes absolute values', () => {
    expect(Money.of(-500, 'INR').negate().amountMinor).toBe(500n);
    expect(Money.of(-500, 'INR').abs().amountMinor).toBe(500n);
    expect(Money.of(500, 'INR').abs().amountMinor).toBe(500n);
  });

  it('multiplies by whole quantities', () => {
    expect(Money.of(1050, 'INR').multiply(3).amountMinor).toBe(3150n);
    expect(() => Money.of(1050, 'INR').multiply(1.5)).toThrow(InvalidMoneyAmountError);
  });

  it('detects overflow during arithmetic rather than wrapping', () => {
    const large = Money.of(MAX_MINOR, 'INR');

    expect(() => large.add(Money.of(1, 'INR'))).toThrow(InvalidMoneyAmountError);
    expect(() => large.multiply(2)).toThrow(InvalidMoneyAmountError);
  });

  it('sums a list', () => {
    const total = Money.sum([Money.of(100, 'INR'), Money.of(250, 'INR'), Money.of(1, 'INR')]);

    expect(total.amountMinor).toBe(351n);
    expect(Money.sum([], 'INR').amountMinor).toBe(0n);
    expect(() => Money.sum([])).toThrow(InvalidMoneyAmountError);
  });
});

describe('Money.applyRate', () => {
  it('computes a basis-point fee with integer arithmetic', () => {
    // 2.5% of ₹1,000.00 is ₹25.00
    expect(Money.of(100000, 'INR').applyRate(250).amountMinor).toBe(2500n);
  });

  it('applies the requested rounding mode at the half', () => {
    // 1.5 minor units exactly.
    const amount = Money.of(3, 'INR');

    expect(amount.applyRate(5000, 'HALF_UP').amountMinor).toBe(2n);
    expect(amount.applyRate(5000, 'HALF_EVEN').amountMinor).toBe(2n);
    expect(amount.applyRate(5000, 'FLOOR').amountMinor).toBe(1n);
    expect(amount.applyRate(5000, 'CEIL').amountMinor).toBe(2n);
  });

  it('rounds HALF_EVEN towards the even neighbour', () => {
    // 2.5 -> 2 (even), 7.5 -> 8 (even)
    expect(Money.of(5, 'INR').applyRate(5000, 'HALF_EVEN').amountMinor).toBe(2n);
    expect(Money.of(15, 'INR').applyRate(5000, 'HALF_EVEN').amountMinor).toBe(8n);
  });

  it('rounds negative amounts symmetrically', () => {
    expect(Money.of(-3, 'INR').applyRate(5000, 'HALF_UP').amountMinor).toBe(-2n);
    expect(Money.of(-3, 'INR').applyRate(5000, 'FLOOR').amountMinor).toBe(-2n);
    expect(Money.of(-3, 'INR').applyRate(5000, 'CEIL').amountMinor).toBe(-1n);
  });
});

describe('Money.allocate', () => {
  it('never loses or invents a minor unit', () => {
    const parts = Money.of(10001, 'INR').allocate([1, 1, 1]);

    expect(parts.map((part) => part.amountMinor)).toEqual([3334n, 3334n, 3333n]);
    expect(Money.sum(parts).amountMinor).toBe(10001n);
  });

  it('respects weights', () => {
    const parts = Money.of(10000, 'INR').allocate([70, 30]);

    expect(parts.map((part) => part.amountMinor)).toEqual([7000n, 3000n]);
  });

  it('is deterministic for tied remainders', () => {
    const first = Money.of(100, 'INR').allocate([1, 1, 1]);
    const second = Money.of(100, 'INR').allocate([1, 1, 1]);

    expect(first.map((part) => part.amountMinor)).toEqual(second.map((part) => part.amountMinor));
    expect(first.map((part) => part.amountMinor)).toEqual([34n, 33n, 33n]);
  });

  it('handles negative amounts', () => {
    const parts = Money.of(-10001, 'INR').allocate([1, 1, 1]);

    expect(Money.sum(parts).amountMinor).toBe(-10001n);
  });

  it('rejects invalid weights', () => {
    expect(() => Money.of(100, 'INR').allocate([])).toThrow(InvalidMoneyAmountError);
    expect(() => Money.of(100, 'INR').allocate([0, 0])).toThrow(InvalidMoneyAmountError);
    expect(() => Money.of(100, 'INR').allocate([-1, 2])).toThrow(InvalidMoneyAmountError);
  });
});

describe('Money comparison', () => {
  it('orders amounts', () => {
    const small = Money.of(100, 'INR');
    const large = Money.of(200, 'INR');

    expect(small.lessThan(large)).toBe(true);
    expect(large.greaterThan(small)).toBe(true);
    expect(small.lessThanOrEqual(Money.of(100, 'INR'))).toBe(true);
    expect(small.greaterThanOrEqual(Money.of(100, 'INR'))).toBe(true);
    expect(small.compare(large)).toBe(-1);
    expect(large.compare(small)).toBe(1);
    expect(small.compare(Money.of(100, 'INR'))).toBe(0);
  });

  it('reports sign', () => {
    expect(Money.zero('INR').isZero).toBe(true);
    expect(Money.of(1, 'INR').isPositive).toBe(true);
    expect(Money.of(-1, 'INR').isNegative).toBe(true);
  });
});

describe('Money serialization', () => {
  it('serializes the amount as a string so large values survive JSON', () => {
    const money = Money.of(9_223_372_036_854_775_806n, 'INR');
    const json = JSON.parse(JSON.stringify({ amount: money })) as {
      amount: { amountMinor: string; currency: string };
    };

    expect(json.amount).toEqual({ amountMinor: '9223372036854775806', currency: 'INR' });
    expect(Money.fromJSON(json.amount).equals(money)).toBe(true);
  });

  it('round-trips through JSON', () => {
    for (const money of [
      Money.of(0, 'INR'),
      Money.of(-1, 'USD'),
      Money.of(1050, 'INR'),
      Money.of(1000, 'JPY'),
      Money.of(1234, 'KWD'),
    ]) {
      expect(Money.fromJSON(money.toJSON()).equals(money)).toBe(true);
    }
  });

  it('formats according to the currency exponent', () => {
    expect(Money.of(1000, 'JPY').toDecimalString()).toBe('1000');
    expect(Money.of(1234, 'KWD').toDecimalString()).toBe('1.234');
    expect(Money.of(5, 'INR').toDecimalString()).toBe('0.05');
    expect(Money.of(-5, 'INR').toDecimalString()).toBe('-0.05');
  });
});
