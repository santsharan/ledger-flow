import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { signAccessToken, type PermissionValue } from '@ledgerflow/auth';
import { Database, runMigrations } from '@ledgerflow/database';
import {
  createTestApp,
  silentLogger,
  startPostgres,
  type PostgresFixture,
} from '@ledgerflow/test-utils';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from './app.module';
import { testServiceContext } from './testing/service-context';

const JWT_SECRET = 'ledger-test-secret-long-enough-for-hs256-ok';

let fixture: PostgresFixture;
let database: Database;
let app: NestFastifyApplication;

async function auth(permissions: PermissionValue[], merchantId?: string): Promise<Record<string, string>> {
  const token = await signAccessToken(
    {
      subject: 'ledger-tester',
      actorType: 'USER',
      roles: ['TEST'],
      permissions,
      ...(merchantId === undefined ? {} : { merchantId }),
      expiresInSeconds: 600,
    },
    JWT_SECRET,
  );
  return { authorization: `Bearer ${token}` };
}

async function openAccount(input: {
  accountCode: string;
  accountType: string;
  currency?: string;
  merchantId?: string;
}): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/accounts',
    headers: await auth(['ledger.post']),
    payload: {
      accountCode: input.accountCode,
      accountType: input.accountType,
      currency: input.currency ?? 'INR',
      ...(input.merchantId === undefined ? {} : { merchantId: input.merchantId }),
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ id: string }>().id;
}

async function postJournal(input: {
  referenceId?: string;
  lines: { accountId: string; direction: 'DEBIT' | 'CREDIT'; amountMinor: string; currency?: string }[];
  currency?: string;
  headers?: Record<string, string>;
}): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: '/api/v1/journals',
    headers: input.headers ?? (await auth(['ledger.post'])),
    payload: {
      transactionId: randomUUID(),
      referenceType: 'PAYMENT_CAPTURE',
      referenceId: input.referenceId ?? randomUUID(),
      currency: input.currency ?? 'INR',
      description: 'test posting',
      lines: input.lines.map((line) => ({ currency: input.currency ?? 'INR', ...line })),
    },
  });
}

beforeAll(async () => {
  fixture = await startPostgres({ database: 'ledgerflow_ledger_test' });
  await runMigrations({
    connectionString: fixture.connectionString,
    directory: join(__dirname, '..', 'migrations'),
    serviceName: 'ledger-service',
    logger: silentLogger(),
  });
  database = new Database({ connectionString: fixture.connectionString, maxConnections: 20 }, silentLogger());
  app = await createTestApp({
    rootModule: AppModule.register(testServiceContext('ledger-service'), {
      SERVICE_NAME: 'ledger-service',
      LEDGER_DATABASE_URL: fixture.connectionString,
      JWT_SECRET,
      DATABASE_MAX_CONNECTIONS: '20',
    }),
    serviceName: 'ledger-service',
    globalPrefix: 'api/v1',
  });
}, 180_000);

afterAll(async () => {
  await app.close();
  await database.close();
  await fixture.stop();
});

beforeEach(async () => {
  await database.query(
    'TRUNCATE ledger_entries, account_balances, journals, accounts, audit_events RESTART IDENTITY CASCADE',
  );
});

describe('posting', () => {
  it('posts a balanced capture and reports equal debits and credits', async () => {
    const merchantId = randomUUID();
    const receivable = await openAccount({
      accountCode: 'MERCHANT_RECEIVABLE',
      accountType: 'ASSET',
      merchantId,
    });
    const payable = await openAccount({
      accountCode: 'MERCHANT_PAYABLE',
      accountType: 'LIABILITY',
      merchantId,
    });

    const posted = await postJournal({
      lines: [
        { accountId: receivable, direction: 'DEBIT', amountMinor: '100000' },
        { accountId: payable, direction: 'CREDIT', amountMinor: '100000' },
      ],
    });

    expect(posted.statusCode, posted.body).toBe(201);
    const journal = posted.json<{ id: string; lines: { direction: string; amountMinor: string }[] }>();
    const debits = journal.lines
      .filter((line) => line.direction === 'DEBIT')
      .reduce((sum, line) => sum + BigInt(line.amountMinor), 0n);
    const credits = journal.lines
      .filter((line) => line.direction === 'CREDIT')
      .reduce((sum, line) => sum + BigInt(line.amountMinor), 0n);
    expect(debits).toBe(credits);
    expect(debits).toBe(100000n);

    const receivableBalance = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${receivable}/balance`,
      headers: await auth(['ledger.read']),
    });
    const payableBalance = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${payable}/balance`,
      headers: await auth(['ledger.read']),
    });

    expect(receivableBalance.json()).toMatchObject({
      balanceMinor: '100000',
      debitMinor: '100000',
      creditMinor: '0',
    });
    expect(payableBalance.json()).toMatchObject({
      balanceMinor: '100000',
      debitMinor: '0',
      creditMinor: '100000',
    });
  });

  it('rejects an unbalanced journal and writes nothing', async () => {
    const merchantId = randomUUID();
    const receivable = await openAccount({
      accountCode: 'MERCHANT_RECEIVABLE',
      accountType: 'ASSET',
      merchantId,
    });
    const payable = await openAccount({
      accountCode: 'MERCHANT_PAYABLE',
      accountType: 'LIABILITY',
      merchantId,
    });

    const response = await postJournal({
      lines: [
        { accountId: receivable, direction: 'DEBIT', amountMinor: '100' },
        { accountId: payable, direction: 'CREDIT', amountMinor: '90' },
      ],
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('JOURNAL_NOT_BALANCED');
    expect(response.json().error.details).toEqual({ debitMinor: '100', creditMinor: '90' });

    const journals = await database.query('SELECT id FROM journals');
    expect(journals.rowCount).toBe(0);
  });

  it('rejects mixed currencies and a non-integer amount', async () => {
    const merchantId = randomUUID();
    const receivable = await openAccount({
      accountCode: 'MERCHANT_RECEIVABLE',
      accountType: 'ASSET',
      merchantId,
    });
    const payable = await openAccount({
      accountCode: 'MERCHANT_PAYABLE',
      accountType: 'LIABILITY',
      merchantId,
      currency: 'USD',
    });

    const mixed = await postJournal({
      lines: [
        { accountId: receivable, direction: 'DEBIT', amountMinor: '100', currency: 'INR' },
        { accountId: payable, direction: 'CREDIT', amountMinor: '100', currency: 'USD' },
      ],
    });
    expect(mixed.statusCode).toBe(409);
    expect(mixed.json().error.code).toBe('JOURNAL_CURRENCY_MIXED');

    const fractional = await app.inject({
      method: 'POST',
      url: '/api/v1/journals',
      headers: await auth(['ledger.post']),
      payload: {
        transactionId: randomUUID(),
        referenceType: 'PAYMENT_CAPTURE',
        referenceId: randomUUID(),
        currency: 'INR',
        description: 'bad amount',
        lines: [
          { accountId: receivable, direction: 'DEBIT', amountMinor: '10.50', currency: 'INR' },
          { accountId: receivable, direction: 'CREDIT', amountMinor: '10.50', currency: 'INR' },
        ],
      },
    });
    expect(fractional.statusCode).toBe(400);
    expect(fractional.json().error.code).toBe('VALIDATION_FAILED');
  });

  it('returns the original journal when the same reference is posted again', async () => {
    const merchantId = randomUUID();
    const left = await openAccount({ accountCode: 'MERCHANT_RECEIVABLE', accountType: 'ASSET', merchantId });
    const right = await openAccount({ accountCode: 'MERCHANT_PAYABLE', accountType: 'LIABILITY', merchantId });
    const referenceId = randomUUID();
    const lines = [
      { accountId: left, direction: 'DEBIT' as const, amountMinor: '500' },
      { accountId: right, direction: 'CREDIT' as const, amountMinor: '500' },
    ];

    const first = await postJournal({ referenceId, lines });
    const second = await postJournal({ referenceId, lines });

    expect(first.json<{ replayed: boolean }>().replayed).toBe(false);
    expect(second.json<{ id: string; replayed: boolean }>().replayed).toBe(true);
    expect(second.json<{ id: string }>().id).toBe(first.json<{ id: string }>().id);

    const journals = await database.query('SELECT id FROM journals');
    expect(journals.rowCount).toBe(1);

    const balance = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${left}/balance`,
      headers: await auth(['ledger.read']),
    });
    expect(balance.json<{ balanceMinor: string }>().balanceMinor).toBe('500');
  });

  it('rejects the same reference with different lines', async () => {
    const merchantId = randomUUID();
    const left = await openAccount({ accountCode: 'MERCHANT_RECEIVABLE', accountType: 'ASSET', merchantId });
    const right = await openAccount({ accountCode: 'MERCHANT_PAYABLE', accountType: 'LIABILITY', merchantId });
    const referenceId = randomUUID();

    await postJournal({
      referenceId,
      lines: [
        { accountId: left, direction: 'DEBIT', amountMinor: '500' },
        { accountId: right, direction: 'CREDIT', amountMinor: '500' },
      ],
    });

    const conflict = await postJournal({
      referenceId,
      lines: [
        { accountId: left, direction: 'DEBIT', amountMinor: '700' },
        { accountId: right, direction: 'CREDIT', amountMinor: '700' },
      ],
    });

    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('JOURNAL_ALREADY_POSTED');
  });
});

describe('immutability and reversal', () => {
  it('corrects a journal only by reversal and restores the balance', async () => {
    const merchantId = randomUUID();
    const left = await openAccount({ accountCode: 'MERCHANT_RECEIVABLE', accountType: 'ASSET', merchantId });
    const right = await openAccount({ accountCode: 'MERCHANT_PAYABLE', accountType: 'LIABILITY', merchantId });

    const posted = await postJournal({
      lines: [
        { accountId: left, direction: 'DEBIT', amountMinor: '1000' },
        { accountId: right, direction: 'CREDIT', amountMinor: '1000' },
      ],
    });
    const journalId = posted.json<{ id: string }>().id;

    const reversed = await app.inject({
      method: 'POST',
      url: `/api/v1/journals/${journalId}/reverse`,
      headers: await auth(['ledger.post']),
      payload: { transactionId: randomUUID(), reason: 'posted the wrong amount' },
    });

    expect(reversed.statusCode, reversed.body).toBe(201);
    const reversal = reversed.json<{ id: string; reversesJournalId: string; lines: { direction: string }[] }>();
    expect(reversal.reversesJournalId).toBe(journalId);
    expect(reversal.lines.map((line) => line.direction)).toEqual(['CREDIT', 'DEBIT']);

    const original = await app.inject({
      method: 'GET',
      url: `/api/v1/journals/${journalId}`,
      headers: await auth(['ledger.read']),
    });
    expect(original.json<{ status: string }>().status).toBe('REVERSED');

    const balance = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${left}/balance`,
      headers: await auth(['ledger.read']),
    });
    expect(balance.json<{ balanceMinor: string; debitMinor: string; creditMinor: string }>()).toMatchObject({
      balanceMinor: '0',
      debitMinor: '1000',
      creditMinor: '1000',
    });

    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/journals/${journalId}/reverse`,
      headers: await auth(['ledger.post']),
      payload: { transactionId: randomUUID(), reason: 'retry of the same reversal' },
    });
    expect(again.json<{ id: string; replayed: boolean }>().id).toBe(reversal.id);
    expect(again.json<{ replayed: boolean }>().replayed).toBe(true);

    const reverseTheReversal = await app.inject({
      method: 'POST',
      url: `/api/v1/journals/${reversal.id}/reverse`,
      headers: await auth(['ledger.post']),
      payload: { transactionId: randomUUID(), reason: 'should not be allowed' },
    });
    expect(reverseTheReversal.statusCode).toBe(409);
    expect(reverseTheReversal.json().error.code).toBe('JOURNAL_ALREADY_REVERSED');
  });

  it('rejects updates and deletes of posted entries and journals', async () => {
    const merchantId = randomUUID();
    const left = await openAccount({ accountCode: 'MERCHANT_RECEIVABLE', accountType: 'ASSET', merchantId });
    const right = await openAccount({ accountCode: 'MERCHANT_PAYABLE', accountType: 'LIABILITY', merchantId });
    await postJournal({
      lines: [
        { accountId: left, direction: 'DEBIT', amountMinor: '250' },
        { accountId: right, direction: 'CREDIT', amountMinor: '250' },
      ],
    });

    await expect(database.query(`UPDATE ledger_entries SET amount_minor = 1`)).rejects.toThrow();
    await expect(database.query('DELETE FROM ledger_entries')).rejects.toThrow();
    await expect(database.query(`UPDATE journals SET description = 'tampered'`)).rejects.toThrow();
    await expect(database.query(`UPDATE journals SET status = 'REVERSED'`)).rejects.toThrow();
    await expect(database.query('DELETE FROM journals')).rejects.toThrow();
    await expect(database.query(`UPDATE audit_events SET action = 'tampered'`)).rejects.toThrow();

    const amounts = await database.query<{ amount_minor: string }>('SELECT amount_minor FROM ledger_entries');
    expect(amounts.rows.map((row) => row.amount_minor)).toEqual(['250', '250']);
  });

  it('rolls back a journal that bypasses application validation and does not balance', async () => {
    const merchantId = randomUUID();
    const left = await openAccount({ accountCode: 'MERCHANT_RECEIVABLE', accountType: 'ASSET', merchantId });
    const right = await openAccount({ accountCode: 'MERCHANT_PAYABLE', accountType: 'LIABILITY', merchantId });

    await expect(
      database.withTransaction(async (tx) => {
        const journal = await tx.query<{ id: string }>(
          `INSERT INTO journals (transaction_id, reference_type, reference_id, currency, description, lines_digest)
           VALUES ('tx', 'RAW', 'raw-1', 'INR', 'bypass', 'digest') RETURNING id`,
        );
        const journalId = journal.rows[0]!.id;
        await tx.query(
          `INSERT INTO ledger_entries (journal_id, account_id, direction, amount_minor, currency, sequence)
           VALUES ($1, $2, 'DEBIT', 100, 'INR', 1), ($1, $3, 'CREDIT', 40, 'INR', 2)`,
          [journalId, left, right],
        );
      }),
    ).rejects.toThrow();

    const journals = await database.query(`SELECT id FROM journals WHERE reference_id = 'raw-1'`);
    expect(journals.rowCount).toBe(0);
    const entries = await database.query('SELECT id FROM ledger_entries');
    expect(entries.rowCount).toBe(0);
  });
});

describe('concurrency', () => {
  it('applies 20 competing journals exactly once each', async () => {
    const merchantId = randomUUID();
    const left = await openAccount({ accountCode: 'MERCHANT_RECEIVABLE', accountType: 'ASSET', merchantId });
    const right = await openAccount({ accountCode: 'MERCHANT_PAYABLE', accountType: 'LIABILITY', merchantId });

    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        postJournal({
          lines: [
            { accountId: left, direction: 'DEBIT', amountMinor: '100' },
            { accountId: right, direction: 'CREDIT', amountMinor: '100' },
          ],
        }),
      ),
    );

    expect(responses.every((response) => response.statusCode === 201)).toBe(true);

    const balance = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${left}/balance`,
      headers: await auth(['ledger.read']),
    });
    expect(balance.json<{ balanceMinor: string }>().balanceMinor).toBe('2000');

    const journals = await database.query('SELECT id FROM journals');
    expect(journals.rowCount).toBe(20);
    await expectPlatformBalances();
  });

  it('lets only one of 10 identical references create a journal', async () => {
    const merchantId = randomUUID();
    const left = await openAccount({ accountCode: 'MERCHANT_RECEIVABLE', accountType: 'ASSET', merchantId });
    const right = await openAccount({ accountCode: 'MERCHANT_PAYABLE', accountType: 'LIABILITY', merchantId });
    const referenceId = randomUUID();
    const lines = [
      { accountId: left, direction: 'DEBIT' as const, amountMinor: '100' },
      { accountId: right, direction: 'CREDIT' as const, amountMinor: '100' },
    ];

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => postJournal({ referenceId, lines })),
    );

    expect(responses.every((response) => response.statusCode === 201)).toBe(true);
    const ids = new Set(responses.map((response) => response.json<{ id: string }>().id));
    expect(ids.size).toBe(1);
    expect(responses.filter((response) => response.json<{ replayed: boolean }>().replayed === false)).toHaveLength(1);

    const balance = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${left}/balance`,
      headers: await auth(['ledger.read']),
    });
    expect(balance.json<{ balanceMinor: string }>().balanceMinor).toBe('100');
  });
});

describe('invariants', () => {
  it('keeps materialized balances equal to the entry aggregate and debits equal to credits', async () => {
    const merchantId = randomUUID();
    const receivable = await openAccount({ accountCode: 'MERCHANT_RECEIVABLE', accountType: 'ASSET', merchantId });
    const payable = await openAccount({ accountCode: 'MERCHANT_PAYABLE', accountType: 'LIABILITY', merchantId });
    const cash = await openAccount({ accountCode: 'SETTLEMENT_CASH', accountType: 'ASSET' });
    const fees = await openAccount({ accountCode: 'PROCESSING_FEE_REVENUE', accountType: 'REVENUE' });

    await postJournal({
      referenceId: 'capture-1',
      lines: [
        { accountId: receivable, direction: 'DEBIT', amountMinor: '100000' },
        { accountId: payable, direction: 'CREDIT', amountMinor: '100000' },
      ],
    });

    const settlement = await app.inject({
      method: 'POST',
      url: '/api/v1/journals',
      headers: await auth(['ledger.post']),
      payload: {
        transactionId: randomUUID(),
        referenceType: 'SETTLEMENT',
        referenceId: 'settle-1',
        currency: 'INR',
        description: 'settlement',
        lines: [
          { accountId: payable, direction: 'DEBIT', amountMinor: '100000', currency: 'INR' },
          { accountId: cash, direction: 'CREDIT', amountMinor: '99000', currency: 'INR' },
          { accountId: fees, direction: 'CREDIT', amountMinor: '1000', currency: 'INR' },
        ],
      },
    });
    expect(settlement.statusCode, settlement.body).toBe(201);

    await expectPlatformBalances();

    const feeBalance = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${fees}/balance`,
      headers: await auth(['ledger.read']),
    });
    expect(feeBalance.json<{ balanceMinor: string }>().balanceMinor).toBe('1000');
  });
});

describe('authorization', () => {
  it('rejects a caller without ledger.post', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/accounts',
      headers: await auth(['ledger.read']),
      payload: { accountCode: 'MERCHANT_PAYABLE', accountType: 'LIABILITY', currency: 'INR' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('stops a merchant from reading another merchant account', async () => {
    const owner = randomUUID();
    const accountId = await openAccount({
      accountCode: 'MERCHANT_PAYABLE',
      accountType: 'LIABILITY',
      merchantId: owner,
    });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/accounts/${accountId}/balance`,
      headers: await auth(['ledger.read'], randomUUID()),
    });
    expect(response.statusCode).toBe(403);
  });
});

async function expectPlatformBalances(): Promise<void> {
  const totals = await database.query<{ debit_minor: string; credit_minor: string }>(
    `SELECT
       COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'DEBIT'), 0)::text AS debit_minor,
       COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'CREDIT'), 0)::text AS credit_minor
     FROM ledger_entries`,
  );
  expect(totals.rows[0]!.debit_minor).toBe(totals.rows[0]!.credit_minor);

  const unbalanced = await database.query(
    `SELECT j.id
     FROM journals j
     LEFT JOIN (
       SELECT journal_id,
              COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'DEBIT'), 0) AS debit_minor,
              COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'CREDIT'), 0) AS credit_minor,
              COUNT(*) AS entry_count
       FROM ledger_entries
       GROUP BY journal_id
     ) e ON e.journal_id = j.id
     WHERE e.entry_count IS NULL OR e.entry_count < 2 OR e.debit_minor <> e.credit_minor`,
  );
  expect(unbalanced.rowCount).toBe(0);

  const drift = await database.query(
    `SELECT a.id
     FROM accounts a
     JOIN account_balances b ON b.account_id = a.id
     JOIN (
       SELECT account_id,
              COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'DEBIT'), 0) AS debit_minor,
              COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'CREDIT'), 0) AS credit_minor
       FROM ledger_entries
       GROUP BY account_id
     ) e ON e.account_id = a.id
     WHERE b.debit_minor <> e.debit_minor OR b.credit_minor <> e.credit_minor`,
  );
  expect(drift.rowCount).toBe(0);
}
