import { Injectable } from '@nestjs/common';
import { type Executor } from '@ledgerflow/database';
import { type AccountType, type Direction } from './domain/posting';

export interface AccountRecord {
  readonly id: string;
  readonly merchantId: string | null;
  readonly accountCode: string;
  readonly accountType: AccountType;
  readonly currency: string;
  readonly status: 'ACTIVE' | 'CLOSED';
  readonly createdAt: Date;
}

export interface JournalRecord {
  readonly id: string;
  readonly transactionId: string;
  readonly referenceType: string;
  readonly referenceId: string;
  readonly currency: string;
  readonly description: string;
  readonly status: 'POSTED' | 'REVERSED';
  readonly reversesJournalId: string | null;
  readonly linesDigest: string;
  readonly postedAt: Date;
}

export interface EntryRecord {
  readonly id: string;
  readonly journalId: string;
  readonly accountId: string;
  readonly direction: Direction;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly sequence: number;
  readonly createdAt: Date;
}

export interface BalanceRecord {
  readonly accountId: string;
  readonly debitMinor: bigint;
  readonly creditMinor: bigint;
  readonly balanceMinor: bigint;
  readonly version: bigint;
}

interface AccountRow {
  id: string;
  merchant_id: string | null;
  account_code: string;
  account_type: AccountType;
  currency: string;
  status: 'ACTIVE' | 'CLOSED';
  created_at: Date;
}

interface JournalRow {
  id: string;
  transaction_id: string;
  reference_type: string;
  reference_id: string;
  currency: string;
  description: string;
  status: 'POSTED' | 'REVERSED';
  reverses_journal_id: string | null;
  lines_digest: string;
  posted_at: Date;
}

const ACCOUNT_COLUMNS = `id, merchant_id, account_code, account_type, currency, status, created_at`;
const JOURNAL_COLUMNS = `id, transaction_id, reference_type, reference_id, currency, description,
  status, reverses_journal_id, lines_digest, posted_at`;

@Injectable()
export class LedgerRepository {
  async insertAccount(
    executor: Executor,
    input: {
      merchantId: string | null;
      accountCode: string;
      accountType: AccountType;
      currency: string;
    },
  ): Promise<AccountRecord> {
    const result = await executor.query<AccountRow>(
      `INSERT INTO accounts (merchant_id, account_code, account_type, currency)
       VALUES ($1, $2, $3, $4)
       RETURNING ${ACCOUNT_COLUMNS}`,
      [input.merchantId, input.accountCode, input.accountType, input.currency],
    );

    await executor.query(
      `INSERT INTO account_balances (account_id) VALUES ($1)`,
      [result.rows[0]!.id],
    );

    return toAccount(result.rows[0]!);
  }

  async findAccount(executor: Executor, id: string): Promise<AccountRecord | null> {
    const result = await executor.query<AccountRow>(
      `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = $1`,
      [id],
    );
    return result.rows[0] === undefined ? null : toAccount(result.rows[0]);
  }

  async listAccounts(
    executor: Executor,
    input: { merchantId: string | null; limit: number; offset: number },
  ): Promise<AccountRecord[]> {
    const result =
      input.merchantId === null
        ? await executor.query<AccountRow>(
            `SELECT ${ACCOUNT_COLUMNS} FROM accounts ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
            [input.limit, input.offset],
          )
        : await executor.query<AccountRow>(
            `SELECT ${ACCOUNT_COLUMNS} FROM accounts
             WHERE merchant_id = $1
             ORDER BY created_at DESC
             LIMIT $2 OFFSET $3`,
            [input.merchantId, input.limit, input.offset],
          );
    return result.rows.map(toAccount);
  }

  async listJournals(
    executor: Executor,
    input: { merchantId: string | null; limit: number; offset: number },
  ): Promise<JournalRecord[]> {
    const columns = `j.id, j.transaction_id, j.reference_type, j.reference_id, j.currency, j.description,
      j.status, j.reverses_journal_id, j.lines_digest, j.posted_at`;
    const result =
      input.merchantId === null
        ? await executor.query<JournalRow>(
            `SELECT ${columns} FROM journals j ORDER BY j.posted_at DESC LIMIT $1 OFFSET $2`,
            [input.limit, input.offset],
          )
        : await executor.query<JournalRow>(
            `SELECT ${columns} FROM journals j
             WHERE EXISTS (
               SELECT 1 FROM ledger_entries e
               JOIN accounts a ON a.id = e.account_id
               WHERE e.journal_id = j.id AND a.merchant_id = $1
             )
             ORDER BY j.posted_at DESC
             LIMIT $2 OFFSET $3`,
            [input.merchantId, input.limit, input.offset],
          );
    return result.rows.map(toJournal);
  }

  async findAccountByCode(
    executor: Executor,
    input: { merchantId: string | null; accountCode: string; currency: string },
  ): Promise<AccountRecord | null> {
    const result =
      input.merchantId === null
        ? await executor.query<AccountRow>(
            `SELECT ${ACCOUNT_COLUMNS} FROM accounts
             WHERE merchant_id IS NULL AND account_code = $1 AND currency = $2`,
            [input.accountCode, input.currency],
          )
        : await executor.query<AccountRow>(
            `SELECT ${ACCOUNT_COLUMNS} FROM accounts
             WHERE merchant_id = $1 AND account_code = $2 AND currency = $3`,
            [input.merchantId, input.accountCode, input.currency],
          );

    return result.rows[0] === undefined ? null : toAccount(result.rows[0]);
  }

  /**
   * Locks the accounts in id order. Callers must pass every id; the returned list is sorted
   * so two journals that share accounts cannot deadlock by locking in opposite orders.
   */
  async lockAccounts(executor: Executor, accountIds: readonly string[]): Promise<AccountRecord[]> {
    const unique = [...new Set(accountIds)].sort();
    const result = await executor.query<AccountRow>(
      `SELECT ${ACCOUNT_COLUMNS} FROM accounts
       WHERE id = ANY($1::uuid[])
       ORDER BY id
       FOR UPDATE`,
      [unique],
    );
    return result.rows.map(toAccount);
  }

  async insertJournal(
    executor: Executor,
    input: {
      transactionId: string;
      referenceType: string;
      referenceId: string;
      currency: string;
      description: string;
      reversesJournalId: string | null;
      linesDigest: string;
    },
  ): Promise<JournalRecord | null> {
    const result = await executor.query<JournalRow>(
      `INSERT INTO journals (
         transaction_id, reference_type, reference_id, currency, description,
         reverses_journal_id, lines_digest
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (reference_type, reference_id) DO NOTHING
       RETURNING ${JOURNAL_COLUMNS}`,
      [
        input.transactionId,
        input.referenceType,
        input.referenceId,
        input.currency,
        input.description,
        input.reversesJournalId,
        input.linesDigest,
      ],
    );

    return result.rows[0] === undefined ? null : toJournal(result.rows[0]);
  }

  async findJournalByReference(
    executor: Executor,
    referenceType: string,
    referenceId: string,
  ): Promise<JournalRecord | null> {
    const result = await executor.query<JournalRow>(
      `SELECT ${JOURNAL_COLUMNS} FROM journals
       WHERE reference_type = $1 AND reference_id = $2`,
      [referenceType, referenceId],
    );
    return result.rows[0] === undefined ? null : toJournal(result.rows[0]);
  }

  async findJournal(executor: Executor, id: string): Promise<JournalRecord | null> {
    const result = await executor.query<JournalRow>(
      `SELECT ${JOURNAL_COLUMNS} FROM journals WHERE id = $1`,
      [id],
    );
    return result.rows[0] === undefined ? null : toJournal(result.rows[0]);
  }

  async lockJournal(executor: Executor, id: string): Promise<JournalRecord | null> {
    const result = await executor.query<JournalRow>(
      `SELECT ${JOURNAL_COLUMNS} FROM journals WHERE id = $1 FOR UPDATE`,
      [id],
    );
    return result.rows[0] === undefined ? null : toJournal(result.rows[0]);
  }

  async findReversal(executor: Executor, journalId: string): Promise<JournalRecord | null> {
    const result = await executor.query<JournalRow>(
      `SELECT ${JOURNAL_COLUMNS} FROM journals WHERE reverses_journal_id = $1`,
      [journalId],
    );
    return result.rows[0] === undefined ? null : toJournal(result.rows[0]);
  }

  async markReversed(executor: Executor, journalId: string): Promise<void> {
    await executor.query(
      `UPDATE journals SET status = 'REVERSED' WHERE id = $1 AND status = 'POSTED'`,
      [journalId],
    );
  }

  async insertEntries(
    executor: Executor,
    journalId: string,
    lines: readonly {
      accountId: string;
      direction: Direction;
      amountMinor: bigint;
      currency: string;
    }[],
  ): Promise<EntryRecord[]> {
    const entries: EntryRecord[] = [];

    for (const [index, line] of lines.entries()) {
      const result = await executor.query<{
        id: string;
        journal_id: string;
        account_id: string;
        direction: Direction;
        amount_minor: string;
        currency: string;
        sequence: number;
        created_at: Date;
      }>(
        `INSERT INTO ledger_entries (journal_id, account_id, direction, amount_minor, currency, sequence)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, journal_id, account_id, direction, amount_minor, currency, sequence, created_at`,
        [journalId, line.accountId, line.direction, line.amountMinor.toString(), line.currency, index + 1],
      );
      const row = result.rows[0]!;
      entries.push({
        id: row.id,
        journalId: row.journal_id,
        accountId: row.account_id,
        direction: row.direction,
        amountMinor: BigInt(row.amount_minor),
        currency: row.currency.trim(),
        sequence: row.sequence,
        createdAt: row.created_at,
      });
    }

    return entries;
  }

  async findEntries(executor: Executor, journalId: string): Promise<EntryRecord[]> {
    const result = await executor.query<{
      id: string;
      journal_id: string;
      account_id: string;
      direction: Direction;
      amount_minor: string;
      currency: string;
      sequence: number;
      created_at: Date;
    }>(
      `SELECT id, journal_id, account_id, direction, amount_minor, currency, sequence, created_at
       FROM ledger_entries WHERE journal_id = $1 ORDER BY sequence`,
      [journalId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      journalId: row.journal_id,
      accountId: row.account_id,
      direction: row.direction,
      amountMinor: BigInt(row.amount_minor),
      currency: row.currency.trim(),
      sequence: row.sequence,
      createdAt: row.created_at,
    }));
  }

  async listEntriesForAccount(
    executor: Executor,
    accountId: string,
    limit: number,
  ): Promise<EntryRecord[]> {
    const result = await executor.query<{
      id: string;
      journal_id: string;
      account_id: string;
      direction: Direction;
      amount_minor: string;
      currency: string;
      sequence: number;
      created_at: Date;
    }>(
      `SELECT id, journal_id, account_id, direction, amount_minor, currency, sequence, created_at
       FROM ledger_entries WHERE account_id = $1
       ORDER BY created_at DESC, sequence DESC
       LIMIT $2`,
      [accountId, limit],
    );

    return result.rows.map((row) => ({
      id: row.id,
      journalId: row.journal_id,
      accountId: row.account_id,
      direction: row.direction,
      amountMinor: BigInt(row.amount_minor),
      currency: row.currency.trim(),
      sequence: row.sequence,
      createdAt: row.created_at,
    }));
  }

  async applyBalanceDeltas(
    executor: Executor,
    deltas: readonly {
      accountId: string;
      accountType: AccountType;
      debitMinor: bigint;
      creditMinor: bigint;
    }[],
  ): Promise<void> {
    for (const delta of [...deltas].sort((left, right) => (left.accountId < right.accountId ? -1 : 1))) {
      const result = await executor.query(
        `UPDATE account_balances
         SET debit_minor = debit_minor + $2,
             credit_minor = credit_minor + $3,
             balance_minor = CASE
               WHEN $4 IN ('ASSET', 'EXPENSE')
                 THEN (debit_minor + $2) - (credit_minor + $3)
               ELSE (credit_minor + $3) - (debit_minor + $2)
             END,
             version = version + 1,
             updated_at = now()
         WHERE account_id = $1`,
        [delta.accountId, delta.debitMinor.toString(), delta.creditMinor.toString(), delta.accountType],
      );

      if (result.rowCount !== 1) {
        throw new Error(`Balance row missing for account ${delta.accountId}.`);
      }
    }
  }

  async findBalance(executor: Executor, accountId: string): Promise<BalanceRecord | null> {
    const result = await executor.query<{
      account_id: string;
      debit_minor: string;
      credit_minor: string;
      balance_minor: string;
      version: string;
    }>(
      `SELECT account_id, debit_minor, credit_minor, balance_minor, version
       FROM account_balances WHERE account_id = $1`,
      [accountId],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      accountId: row.account_id,
      debitMinor: BigInt(row.debit_minor),
      creditMinor: BigInt(row.credit_minor),
      balanceMinor: BigInt(row.balance_minor),
      version: BigInt(row.version),
    };
  }

  /** Authoritative balance, summed from entries rather than the materialized row. */
  async aggregateBalance(
    executor: Executor,
    accountId: string,
  ): Promise<{ debitMinor: bigint; creditMinor: bigint }> {
    const result = await executor.query<{ debit_minor: string; credit_minor: string }>(
      `SELECT
         COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'DEBIT'), 0)::text AS debit_minor,
         COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'CREDIT'), 0)::text AS credit_minor
       FROM ledger_entries WHERE account_id = $1`,
      [accountId],
    );
    const row = result.rows[0]!;
    return { debitMinor: BigInt(row.debit_minor), creditMinor: BigInt(row.credit_minor) };
  }
}

function toAccount(row: AccountRow): AccountRecord {
  return {
    id: row.id,
    merchantId: row.merchant_id,
    accountCode: row.account_code,
    accountType: row.account_type,
    currency: row.currency.trim(),
    status: row.status,
    createdAt: row.created_at,
  };
}

function toJournal(row: JournalRow): JournalRecord {
  return {
    id: row.id,
    transactionId: row.transaction_id,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    currency: row.currency.trim(),
    description: row.description,
    status: row.status,
    reversesJournalId: row.reverses_journal_id,
    linesDigest: row.lines_digest,
    postedAt: row.posted_at,
  };
}
