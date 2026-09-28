import { Inject, Injectable } from '@nestjs/common';
import { writeAudit } from '@ledgerflow/audit';
import { assertMerchantAccess, type Principal } from '@ledgerflow/auth';
import {
  type AccountResponse,
  type BalanceResponse,
  type JournalLineResponse,
  type JournalResponse,
  type OpenAccountRequest,
  type PostJournalRequest,
} from '@ledgerflow/contracts';
import { Database } from '@ledgerflow/database';
import {
  BusinessConflictError,
  ErrorCode,
  ForbiddenError,
  InternalError,
  NotFoundError,
} from '@ledgerflow/errors';
import { type Logger } from '@ledgerflow/logger';
import { MetricName, increment } from '@ledgerflow/observability';
import { getCurrency } from '@ledgerflow/money';
import { getRequestContext, LOGGER } from '@ledgerflow/service-core';
import {
  normalBalance,
  postingDigest,
  reversalLines,
  validatePosting,
  type AccountType,
  type PostingLine,
} from './domain/posting';
import {
  LedgerRepository,
  type AccountRecord,
  type EntryRecord,
  type JournalRecord,
} from './ledger.repository';

@Injectable()
export class LedgerService {
  constructor(
    private readonly database: Database,
    private readonly ledger: LedgerRepository,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async openAccount(actor: Principal, request: OpenAccountRequest): Promise<AccountResponse> {
    getCurrency(request.currency);
    const merchantId = this.resolveMerchant(actor, request.merchantId ?? null);

    try {
      return await this.database.withTransaction(async (tx) => {
        const account = await this.ledger.insertAccount(tx, {
          merchantId,
          accountCode: request.accountCode,
          accountType: request.accountType,
          currency: request.currency,
        });

        await writeAudit(tx, {
          ...actorAudit(actor),
          action: 'ledger.account.opened',
          resourceType: 'account',
          resourceId: account.id,
          afterState: {
            accountCode: account.accountCode,
            accountType: account.accountType,
            currency: account.currency,
            merchantId: account.merchantId,
          },
          ...correlation(),
        });

        return toAccountResponse(account);
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      const existing = await this.ledger.findAccountByCode(this.database, {
        merchantId,
        accountCode: request.accountCode,
        currency: request.currency,
      });

      if (
        existing !== null &&
        existing.accountType === request.accountType &&
        existing.currency === request.currency
      ) {
        return toAccountResponse(existing);
      }

      throw new BusinessConflictError(
        ErrorCode.CONFLICT,
        'An account with this code already exists with a different type.',
        { accountCode: request.accountCode, currency: request.currency },
      );
    }
  }

  async lookupAccount(
    actor: Principal,
    query: { accountCode: string; currency: string; merchantId?: string },
  ): Promise<AccountResponse> {
    const merchantId = this.resolveMerchant(actor, query.merchantId ?? null);
    const account = await this.ledger.findAccountByCode(this.database, {
      merchantId,
      accountCode: query.accountCode,
      currency: query.currency.toUpperCase(),
    });
    if (account === null) {
      throw new NotFoundError(ErrorCode.ACCOUNT_NOT_FOUND, 'Account not found.');
    }
    this.assertAccountAccess(actor, account);
    return toAccountResponse(account);
  }

  async getAccount(actor: Principal, accountId: string): Promise<AccountResponse> {
    const account = await this.requireAccount(accountId);
    this.assertAccountAccess(actor, account);
    return toAccountResponse(account);
  }

  async listAccounts(
    actor: Principal,
    page: { limit: number; offset: number },
  ): Promise<AccountResponse[]> {
    const rows = await this.ledger.listAccounts(this.database, {
      merchantId: actor.merchantId ?? null,
      limit: page.limit,
      offset: page.offset,
    });
    return rows.map(toAccountResponse);
  }

  async listJournals(
    actor: Principal,
    page: { limit: number; offset: number },
  ): Promise<JournalSummary[]> {
    const rows = await this.ledger.listJournals(this.database, {
      merchantId: actor.merchantId ?? null,
      limit: page.limit,
      offset: page.offset,
    });
    return rows.map((journal) => ({
      id: journal.id,
      transactionId: journal.transactionId,
      referenceType: journal.referenceType,
      referenceId: journal.referenceId,
      currency: journal.currency,
      description: journal.description,
      status: journal.status,
      reversesJournalId: journal.reversesJournalId,
      postedAt: journal.postedAt.toISOString(),
    }));
  }

  async getBalance(actor: Principal, accountId: string): Promise<BalanceResponse> {
    const account = await this.requireAccount(accountId);
    this.assertAccountAccess(actor, account);

    const [materialized, aggregate] = await Promise.all([
      this.ledger.findBalance(this.database, accountId),
      this.ledger.aggregateBalance(this.database, accountId),
    ]);

    if (materialized === null) {
      throw new InternalError('Account is missing its balance row.');
    }

    const authoritative = normalBalance(
      account.accountType,
      aggregate.debitMinor,
      aggregate.creditMinor,
    );

    if (
      materialized.debitMinor !== aggregate.debitMinor ||
      materialized.creditMinor !== aggregate.creditMinor ||
      materialized.balanceMinor !== authoritative
    ) {
      this.logger.error(
        {
          event: 'ledger.balance.drift',
          accountId,
          materialized: materialized.balanceMinor.toString(),
          authoritative: authoritative.toString(),
        },
        'materialized balance does not match ledger entries',
      );
      throw new InternalError('Ledger balance drift detected.');
    }

    return {
      accountId: account.id,
      accountCode: account.accountCode,
      accountType: account.accountType,
      currency: account.currency,
      debitMinor: materialized.debitMinor.toString(),
      creditMinor: materialized.creditMinor.toString(),
      balanceMinor: materialized.balanceMinor.toString(),
    };
  }

  async listEntries(actor: Principal, accountId: string, limit: number): Promise<JournalLineResponse[]> {
    const account = await this.requireAccount(accountId);
    this.assertAccountAccess(actor, account);
    const entries = await this.ledger.listEntriesForAccount(this.database, accountId, limit);
    return entries.map(toLineResponse);
  }

  /**
   * Posts a balanced journal.
   *
   * The same reference returns the original journal. A reused reference with different lines
   * is a conflict — it must not silently post a second economic effect.
   *
   * The LedgerPosted outbox row is inserted in this same transaction in Phase 7, before
   * commit. Nothing is published from inside the transaction.
   */
  async postJournal(actor: Principal, request: PostJournalRequest): Promise<JournalResponse> {
    getCurrency(request.currency);

    const lines: PostingLine[] = request.lines.map((line) => ({
      accountId: line.accountId,
      direction: line.direction,
      amountMinor: BigInt(line.amountMinor),
      currency: line.currency,
    }));

    validatePosting(request.currency, lines);
    const digest = postingDigest(request.currency, lines);

    return this.database.withTransaction(async (tx) => {
      const inserted = await this.ledger.insertJournal(tx, {
        transactionId: request.transactionId,
        referenceType: request.referenceType,
        referenceId: request.referenceId,
        currency: request.currency,
        description: request.description,
        reversesJournalId: null,
        linesDigest: digest,
      });

      if (inserted === null) {
        const existing = await this.ledger.findJournalByReference(
          tx,
          request.referenceType,
          request.referenceId,
        );
        if (existing === null) {
          throw new InternalError('Journal reference conflict without an existing journal.');
        }
        if (existing.linesDigest !== digest) {
          throw new BusinessConflictError(
            ErrorCode.JOURNAL_ALREADY_POSTED,
            'This reference was already posted with different lines.',
            { journalId: existing.id, referenceType: request.referenceType, referenceId: request.referenceId },
          );
        }
        const existingLines = await this.ledger.findEntries(tx, existing.id);
        return toJournalResponse(existing, existingLines, true);
      }

      const entries = await this.postLines(tx, actor, inserted, lines);
      return toJournalResponse(inserted, entries, false);
    });
  }

  async getJournal(actor: Principal, journalId: string): Promise<JournalResponse> {
    const journal = await this.ledger.findJournal(this.database, journalId);
    if (journal === null) {
      throw new NotFoundError(ErrorCode.NOT_FOUND, 'Journal not found.');
    }
    const entries = await this.ledger.findEntries(this.database, journal.id);
    await this.assertLinesAccess(actor, entries);
    return toJournalResponse(journal, entries, false);
  }

  /**
   * Corrects a posted journal by posting the opposite entry set.
   *
   * A retried reversal returns the reversal that already exists. A reversal journal itself
   * cannot be reversed; the correction is a new journal that reverses the corrected one.
   */
  async reverseJournal(
    actor: Principal,
    journalId: string,
    input: { transactionId: string; reason: string },
  ): Promise<JournalResponse> {
    return this.database.withTransaction(async (tx) => {
      const original = await this.ledger.lockJournal(tx, journalId);
      if (original === null) {
        throw new NotFoundError(ErrorCode.NOT_FOUND, 'Journal not found.');
      }

      if (original.reversesJournalId !== null) {
        throw new BusinessConflictError(
          ErrorCode.JOURNAL_ALREADY_REVERSED,
          'A reversal journal cannot itself be reversed. Post a new correcting journal instead.',
          { journalId },
        );
      }

      const existing = await this.ledger.findReversal(tx, journalId);
      if (existing !== null) {
        const existingLines = await this.ledger.findEntries(tx, existing.id);
        return toJournalResponse(existing, existingLines, true);
      }

      const originalLines = await this.ledger.findEntries(tx, original.id);
      await this.assertLinesAccess(actor, originalLines);

      const lines = reversalLines(
        originalLines.map((entry) => ({
          accountId: entry.accountId,
          direction: entry.direction,
          amountMinor: entry.amountMinor,
          currency: entry.currency,
        })),
      );
      validatePosting(original.currency, lines);

      const reversal = await this.ledger.insertJournal(tx, {
        transactionId: input.transactionId,
        referenceType: 'REVERSAL',
        referenceId: original.id,
        currency: original.currency,
        description: input.reason,
        reversesJournalId: original.id,
        linesDigest: postingDigest(original.currency, lines),
      });

      if (reversal === null) {
        throw new BusinessConflictError(
          ErrorCode.JOURNAL_ALREADY_REVERSED,
          'This journal has already been reversed.',
          { journalId },
        );
      }

      const entries = await this.postLines(tx, actor, reversal, lines);
      await this.ledger.markReversed(tx, original.id);

      await writeAudit(tx, {
        ...actorAudit(actor),
        action: 'ledger.journal.reversed',
        resourceType: 'journal',
        resourceId: original.id,
        beforeState: { status: 'POSTED' },
        afterState: { status: 'REVERSED', reversalJournalId: reversal.id },
        reason: input.reason,
        ...correlation(),
      });

      this.logger.info(
        { event: 'ledger.journal.reversed', journalId: original.id, reversalJournalId: reversal.id },
        'journal reversed',
      );

      return toJournalResponse(reversal, entries, false);
    });
  }

  private async postLines(
    tx: Parameters<typeof writeAudit>[0],
    actor: Principal,
    journal: JournalRecord,
    lines: readonly PostingLine[],
  ): Promise<EntryRecord[]> {
    const accounts = await this.ledger.lockAccounts(
      tx,
      lines.map((line) => line.accountId),
    );
    const byId = new Map(accounts.map((account) => [account.id, account]));

    for (const line of lines) {
      const account = byId.get(line.accountId);
      if (account === undefined) {
        throw new NotFoundError(ErrorCode.ACCOUNT_NOT_FOUND, 'Account not found.', {
          accountId: line.accountId,
        });
      }
      this.assertAccountAccess(actor, account);
      if (account.status !== 'ACTIVE') {
        throw new BusinessConflictError(ErrorCode.ACCOUNT_INACTIVE, 'Account is not active.', {
          accountId: account.id,
        });
      }
      if (account.currency !== journal.currency) {
        throw new BusinessConflictError(
          ErrorCode.JOURNAL_CURRENCY_MIXED,
          'Account currency does not match the journal.',
          { accountId: account.id, accountCurrency: account.currency, journalCurrency: journal.currency },
        );
      }
    }

    const entries = await this.ledger.insertEntries(tx, journal.id, lines);

    const deltas = new Map<string, { accountType: AccountType; debitMinor: bigint; creditMinor: bigint }>();
    for (const line of lines) {
      const current = deltas.get(line.accountId) ?? {
        accountType: byId.get(line.accountId)!.accountType,
        debitMinor: 0n,
        creditMinor: 0n,
      };
      if (line.direction === 'DEBIT') current.debitMinor += line.amountMinor;
      else current.creditMinor += line.amountMinor;
      deltas.set(line.accountId, current);
    }

    await this.ledger.applyBalanceDeltas(
      tx,
      [...deltas.entries()].map(([accountId, delta]) => ({ accountId, ...delta })),
    );

    await writeAudit(tx, {
      ...actorAudit(actor),
      action: 'ledger.journal.posted',
      resourceType: 'journal',
      resourceId: journal.id,
      afterState: {
        referenceType: journal.referenceType,
        referenceId: journal.referenceId,
        currency: journal.currency,
        lineCount: lines.length,
      },
      ...correlation(),
    });

    increment(MetricName.ledgerJournalsPosted);
    this.logger.info(
      {
        event: 'ledger.journal.posted',
        journalId: journal.id,
        referenceType: journal.referenceType,
        referenceId: journal.referenceId,
      },
      'journal posted',
    );

    return entries;
  }

  private resolveMerchant(actor: Principal, requested: string | null): string | null {
    if (actor.merchantId !== undefined) {
      if (requested !== null && requested !== actor.merchantId) {
        throw new ForbiddenError('This account belongs to another merchant.');
      }
      return actor.merchantId;
    }
    return requested;
  }

  private assertAccountAccess(actor: Principal, account: AccountRecord): void {
    if (actor.merchantId === undefined) return;
    if (account.merchantId === null || account.merchantId !== actor.merchantId) {
      throw new ForbiddenError('This account belongs to another merchant.');
    }
    assertMerchantAccess(actor, account.merchantId);
  }

  private async assertLinesAccess(actor: Principal, entries: readonly EntryRecord[]): Promise<void> {
    if (actor.merchantId === undefined) return;

    const seen = new Set<string>();
    for (const entry of entries) {
      if (seen.has(entry.accountId)) continue;
      seen.add(entry.accountId);
      const account = await this.requireAccount(entry.accountId);
      this.assertAccountAccess(actor, account);
    }
  }

  private async requireAccount(accountId: string): Promise<AccountRecord> {
    const account = await this.ledger.findAccount(this.database, accountId);
    if (account === null) {
      throw new NotFoundError(ErrorCode.ACCOUNT_NOT_FOUND, 'Account not found.');
    }
    return account;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: string }).code === ErrorCode.UNIQUE_VIOLATION
  );
}

function actorAudit(actor: Principal): { actorType: 'USER' | 'SERVICE'; actorId: string } {
  return {
    actorType: actor.actorType === 'SERVICE' ? 'SERVICE' : 'USER',
    actorId: actor.id,
  };
}

function correlation(): { requestId: string | null; correlationId: string | null } {
  const context = getRequestContext();
  return {
    requestId: context?.requestId ?? null,
    correlationId: context?.correlationId ?? null,
  };
}

export interface JournalSummary {
  readonly id: string;
  readonly transactionId: string;
  readonly referenceType: string;
  readonly referenceId: string;
  readonly currency: string;
  readonly description: string;
  readonly status: 'POSTED' | 'REVERSED';
  readonly reversesJournalId: string | null;
  readonly postedAt: string;
}

function toAccountResponse(account: AccountRecord): AccountResponse {
  return {
    id: account.id,
    merchantId: account.merchantId,
    accountCode: account.accountCode,
    accountType: account.accountType,
    currency: account.currency,
    status: account.status,
    createdAt: account.createdAt.toISOString(),
  };
}

function toLineResponse(entry: EntryRecord): JournalLineResponse {
  return {
    accountId: entry.accountId,
    direction: entry.direction,
    amountMinor: entry.amountMinor.toString(),
    currency: entry.currency,
    sequence: entry.sequence,
  };
}

function toJournalResponse(
  journal: JournalRecord,
  entries: readonly EntryRecord[],
  replayed: boolean,
): JournalResponse {
  return {
    id: journal.id,
    transactionId: journal.transactionId,
    referenceType: journal.referenceType,
    referenceId: journal.referenceId,
    currency: journal.currency,
    description: journal.description,
    status: journal.status,
    reversesJournalId: journal.reversesJournalId,
    lines: entries.map(toLineResponse),
    replayed,
  };
}
