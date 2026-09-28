import { createHash } from 'node:crypto';
import { BusinessConflictError, ErrorCode } from '@ledgerflow/errors';
import { MAX_MINOR } from '@ledgerflow/money';

export const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'REVENUE', 'EXPENSE', 'EQUITY'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const DIRECTIONS = ['DEBIT', 'CREDIT'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export interface PostingLine {
  readonly accountId: string;
  readonly direction: Direction;
  readonly amountMinor: bigint;
  readonly currency: string;
}

/** Asset and expense accounts increase on the debit side; the others on the credit side. */
export function normalBalance(accountType: AccountType, debitMinor: bigint, creditMinor: bigint): bigint {
  if (accountType === 'ASSET' || accountType === 'EXPENSE') {
    return debitMinor - creditMinor;
  }
  return creditMinor - debitMinor;
}

export function flipDirection(direction: Direction): Direction {
  return direction === 'DEBIT' ? 'CREDIT' : 'DEBIT';
}

export function reversalLines(lines: readonly PostingLine[]): PostingLine[] {
  return lines.map((line) => ({ ...line, direction: flipDirection(line.direction) }));
}

/**
 * Rejects a journal that cannot be posted.
 *
 * Called before any write. The database repeats the balance and currency checks so a
 * bypassed application path still cannot commit an unbalanced journal.
 */
export function validatePosting(currency: string, lines: readonly PostingLine[]): void {
  if (lines.length < 2) {
    throw new BusinessConflictError(
      ErrorCode.JOURNAL_TOO_FEW_ENTRIES,
      'A journal must contain at least two entries.',
      { entries: lines.length },
    );
  }

  let debit = 0n;
  let credit = 0n;

  for (const line of lines) {
    if (line.amountMinor <= 0n) {
      throw new BusinessConflictError(
        ErrorCode.INVALID_MONEY_AMOUNT,
        'Ledger entry amounts must be positive minor units.',
        { amountMinor: line.amountMinor.toString(), accountId: line.accountId },
      );
    }

    if (line.currency !== currency) {
      throw new BusinessConflictError(
        ErrorCode.JOURNAL_CURRENCY_MIXED,
        'A journal cannot mix currencies.',
        { journalCurrency: currency, lineCurrency: line.currency, accountId: line.accountId },
      );
    }

    if (line.direction === 'DEBIT') debit += line.amountMinor;
    else credit += line.amountMinor;
  }

  if (debit > MAX_MINOR || credit > MAX_MINOR) {
    throw new BusinessConflictError(
      ErrorCode.INVALID_MONEY_AMOUNT,
      'Journal total exceeds the representable minor-unit range.',
    );
  }

  if (debit !== credit) {
    throw new BusinessConflictError(
      ErrorCode.JOURNAL_NOT_BALANCED,
      'Journal debits do not equal credits.',
      { debitMinor: debit.toString(), creditMinor: credit.toString() },
    );
  }
}

/**
 * Identity of a journal's economic content. Line order does not matter, so a retried
 * request with the same lines in a different order is the same posting.
 */
export function postingDigest(currency: string, lines: readonly PostingLine[]): string {
  const canonical = lines
    .map((line) => `${line.accountId}|${line.direction}|${line.amountMinor.toString()}|${line.currency}`)
    .sort()
    .join('\n');

  return createHash('sha256').update(`${currency}\n${canonical}`).digest('hex');
}
