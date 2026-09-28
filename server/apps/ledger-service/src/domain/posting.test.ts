import { BusinessConflictError } from '@ledgerflow/errors';
import { describe, expect, it } from 'vitest';
import {
  flipDirection,
  normalBalance,
  postingDigest,
  reversalLines,
  validatePosting,
  type PostingLine,
} from './posting';

const INR = 'INR';

function line(
  accountId: string,
  direction: PostingLine['direction'],
  amountMinor: bigint,
  currency = INR,
): PostingLine {
  return { accountId, direction, amountMinor, currency };
}

describe('validatePosting', () => {
  it('accepts a balanced journal', () => {
    expect(() =>
      validatePosting(INR, [line('a', 'DEBIT', 100000n), line('b', 'CREDIT', 100000n)]),
    ).not.toThrow();
  });

  it('accepts more than two lines when the sides match', () => {
    expect(() =>
      validatePosting(INR, [
        line('payable', 'DEBIT', 100000n),
        line('cash', 'CREDIT', 99000n),
        line('fees', 'CREDIT', 1000n),
      ]),
    ).not.toThrow();
  });

  it('rejects a journal with fewer than two entries', () => {
    expect(() => validatePosting(INR, [line('a', 'DEBIT', 100n)])).toThrow(BusinessConflictError);
    try {
      validatePosting(INR, [line('a', 'DEBIT', 100n)]);
    } catch (error) {
      expect((error as BusinessConflictError).code).toBe('JOURNAL_TOO_FEW_ENTRIES');
    }
  });

  it('rejects an unbalanced journal and reports both sides', () => {
    try {
      validatePosting(INR, [line('a', 'DEBIT', 100n), line('b', 'CREDIT', 90n)]);
      expect.unreachable('expected unbalanced journal to be rejected');
    } catch (error) {
      const conflict = error as BusinessConflictError;
      expect(conflict.code).toBe('JOURNAL_NOT_BALANCED');
      expect(conflict.details).toEqual({ debitMinor: '100', creditMinor: '90' });
    }
  });

  it('rejects a zero or negative amount', () => {
    expect(() =>
      validatePosting(INR, [line('a', 'DEBIT', 0n), line('b', 'CREDIT', 0n)]),
    ).toThrow(BusinessConflictError);
    expect(() =>
      validatePosting(INR, [line('a', 'DEBIT', -5n), line('b', 'CREDIT', -5n)]),
    ).toThrow(BusinessConflictError);
  });

  it('rejects mixed currencies', () => {
    try {
      validatePosting(INR, [line('a', 'DEBIT', 100n, 'INR'), line('b', 'CREDIT', 100n, 'USD')]);
      expect.unreachable('expected mixed currency to be rejected');
    } catch (error) {
      expect((error as BusinessConflictError).code).toBe('JOURNAL_CURRENCY_MIXED');
    }
  });

  it('rejects a line whose currency differs from the journal currency', () => {
    expect(() =>
      validatePosting('USD', [line('a', 'DEBIT', 100n, 'INR'), line('b', 'CREDIT', 100n, 'INR')]),
    ).toThrow(BusinessConflictError);
  });
});

describe('reversalLines', () => {
  it('swaps every direction and stays balanced', () => {
    const original = [line('a', 'DEBIT', 100n), line('b', 'CREDIT', 40n), line('c', 'CREDIT', 60n)];
    const reversed = reversalLines(original);

    expect(reversed.map((entry) => entry.direction)).toEqual(['CREDIT', 'DEBIT', 'DEBIT']);
    expect(reversed.map((entry) => entry.amountMinor)).toEqual([100n, 40n, 60n]);
    expect(() => validatePosting(INR, reversed)).not.toThrow();
  });

  it('reverses a reversal back to the original directions', () => {
    const original = [line('a', 'DEBIT', 10n), line('b', 'CREDIT', 10n)];
    const twice = reversalLines(reversalLines(original));
    expect(twice.map((entry) => entry.direction)).toEqual(['DEBIT', 'CREDIT']);
  });

  it('flips both directions', () => {
    expect(flipDirection('DEBIT')).toBe('CREDIT');
    expect(flipDirection('CREDIT')).toBe('DEBIT');
  });
});

describe('normalBalance', () => {
  it('is debit-positive for assets and expenses', () => {
    expect(normalBalance('ASSET', 500n, 200n)).toBe(300n);
    expect(normalBalance('EXPENSE', 80n, 30n)).toBe(50n);
  });

  it('is credit-positive for liabilities, revenue and equity', () => {
    expect(normalBalance('LIABILITY', 200n, 500n)).toBe(300n);
    expect(normalBalance('REVENUE', 0n, 1000n)).toBe(1000n);
    expect(normalBalance('EQUITY', 10n, 40n)).toBe(30n);
  });

  it('goes negative when the contra side dominates', () => {
    expect(normalBalance('LIABILITY', 500n, 200n)).toBe(-300n);
  });
});

describe('postingDigest', () => {
  it('is stable when line order changes', () => {
    const first = [line('a', 'DEBIT', 100n), line('b', 'CREDIT', 100n)];
    const second = [line('b', 'CREDIT', 100n), line('a', 'DEBIT', 100n)];

    expect(postingDigest(INR, first)).toBe(postingDigest(INR, second));
  });

  it('changes when the amount, direction, account or currency changes', () => {
    const base = postingDigest(INR, [line('a', 'DEBIT', 100n), line('b', 'CREDIT', 100n)]);

    expect(postingDigest(INR, [line('a', 'DEBIT', 101n), line('b', 'CREDIT', 101n)])).not.toBe(base);
    expect(postingDigest(INR, [line('a', 'CREDIT', 100n), line('b', 'DEBIT', 100n)])).not.toBe(base);
    expect(postingDigest('USD', [line('a', 'DEBIT', 100n, 'USD'), line('b', 'CREDIT', 100n, 'USD')])).not.toBe(
      base,
    );
  });
});
