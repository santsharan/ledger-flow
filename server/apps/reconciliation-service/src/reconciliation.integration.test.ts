import { join } from 'node:path';
import { signAccessToken } from '@ledgerflow/auth';
import { Database, runMigrations } from '@ledgerflow/database';
import {
  createTestApp,
  silentLogger,
  startPostgres,
  type PostgresFixture,
} from '@ledgerflow/test-utils';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from './app.module';
import { testServiceContext } from './testing/service-context';

const JWT_SECRET = 'recon-test-secret-long-enough-for-hs256-ok';

let fixture: PostgresFixture;
let database: Database;
let app: NestFastifyApplication;

async function token(
  permissions: Array<'reconciliation.read' | 'reconciliation.resolve'>,
): Promise<Record<string, string>> {
  const accessToken = await signAccessToken(
    {
      subject: 'recon-operator',
      actorType: 'USER',
      roles: ['RECONCILIATION_OPERATOR'],
      permissions,
      expiresInSeconds: 600,
    },
    JWT_SECRET,
  );
  return { authorization: `Bearer ${accessToken}` };
}

beforeAll(async () => {
  fixture = await startPostgres({ database: 'ledgerflow_reconciliation_test' });
  await runMigrations({
    connectionString: fixture.connectionString,
    directory: join(__dirname, '..', 'migrations'),
    serviceName: 'reconciliation-service',
    logger: silentLogger(),
  });
  database = new Database({ connectionString: fixture.connectionString }, silentLogger());
  app = await createTestApp({
    rootModule: AppModule.register(testServiceContext('reconciliation-service'), {
      SERVICE_NAME: 'reconciliation-service',
      RECONCILIATION_DATABASE_URL: fixture.connectionString,
      JWT_SECRET,
    }),
    serviceName: 'reconciliation-service',
    globalPrefix: 'api/v1',
  });
}, 180_000);

afterAll(async () => {
  await app.close();
  await database.close();
  await fixture.stop();
});

describe('reconciliation demo', () => {
  it('opens an AMOUNT_MISMATCH case and resolves it without changing financial records', async () => {
    const run = await app.inject({
      method: 'POST',
      url: '/api/v1/reconciliation/runs',
      headers: await token(['reconciliation.read']),
      payload: {
        provider: 'acquirer-simulator',
        format: 'JSON',
        internal: [
          {
            paymentReference: 'PAY-001',
            providerReference: 'prov-pay-001',
            amountMinor: '10000',
            currency: 'INR',
            settlementDate: '2026-09-25',
            status: 'CAPTURED',
          },
        ],
        statement: [
          {
            externalReference: 'prov-pay-001',
            paymentReference: 'PAY-001',
            amountMinor: '9900',
            currency: 'INR',
            settlementDate: '2026-09-25',
            status: 'CAPTURED',
          },
        ],
      },
    });

    expect(run.statusCode, run.body).toBe(201);
    const body = run.json<{
      results: { resultType: string; deltaMinor: string; caseId: string | null }[];
    }>();
    expect(body.results[0]).toMatchObject({ resultType: 'AMOUNT_MISMATCH', deltaMinor: '-100' });
    const caseId = body.results[0]!.caseId;
    expect(caseId).toBeTruthy();

    const claimed = await app.inject({
      method: 'POST',
      url: `/api/v1/reconciliation/cases/${caseId}/resolve`,
      headers: await token(['reconciliation.resolve']),
      payload: { to: 'INVESTIGATING', reason: 'operator inspecting the 100 minor-unit gap' },
    });
    expect(claimed.json<{ status: string }>().status).toBe('INVESTIGATING');

    const resolved = await app.inject({
      method: 'POST',
      url: `/api/v1/reconciliation/cases/${caseId}/resolve`,
      headers: await token(['reconciliation.resolve']),
      payload: {
        to: 'RESOLVED',
        reason: 'acquirer confirmed a fee was withheld outside settlement',
      },
    });
    expect(resolved.json<{ status: string }>().status).toBe('RESOLVED');

    const audit = await database.query<{ actor_id: string; reason: string; new_status: string }>(
      `SELECT a.actor_id, c.reason, c.new_status
       FROM audit_events a
       JOIN case_actions c ON c.case_id::text = a.resource_id AND c.new_status = 'RESOLVED'
       WHERE a.action = 'reconciliation.case.resolved'`,
    );
    expect(audit.rows[0]).toMatchObject({
      actor_id: 'recon-operator',
      new_status: 'RESOLVED',
    });
    expect(audit.rows[0]?.reason).toContain('fee was withheld');

    const tables = await database.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('payments', 'ledger_entries')`,
    );
    expect(tables.rowCount).toBe(0);

    const normalized = await database.query<{ amount_minor: string }>(
      `SELECT amount_minor::text AS amount_minor FROM external_transactions WHERE external_reference = 'prov-pay-001'`,
    );
    expect(normalized.rows[0]?.amount_minor).toBe('9900');

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/reconciliation/cases',
      headers: await token(['reconciliation.read']),
    });
    expect(listed.json<{ id: string; status: string }[]>().some((item) => item.id === caseId)).toBe(
      true,
    );

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/reconciliation/cases/${caseId}`,
      headers: await token(['reconciliation.read']),
    });
    expect(
      detail.json<{ actions: { newStatus: string }[] }>().actions.map((action) => action.newStatus),
    ).toEqual(['INVESTIGATING', 'RESOLVED']);
  });

  it('imports a CSV statement', async () => {
    const run = await app.inject({
      method: 'POST',
      url: '/api/v1/reconciliation/runs',
      headers: await token(['reconciliation.read']),
      payload: {
        provider: 'acquirer-simulator',
        format: 'CSV',
        internal: [],
        statement:
          'externalReference,paymentReference,amountMinor,currency,settlementDate,status\nprov-csv,PAY-CSV,5000,INR,2026-09-25,CAPTURED\n',
      },
    });
    expect(run.statusCode, run.body).toBe(201);
    expect(run.json<{ results: { resultType: string }[] }>().results[0]?.resultType).toBe(
      'MISSING_INTERNAL',
    );
    const stored = await database.query(
      `SELECT format FROM statement_imports WHERE format = 'CSV'`,
    );
    expect(stored.rowCount).toBe(1);
  });

  it('restarts an identical import without opening a second case', async () => {
    const payload = {
      provider: 'acquirer-simulator',
      format: 'JSON' as const,
      internal: [
        {
          paymentReference: 'PAY-001',
          providerReference: 'prov-pay-001',
          amountMinor: '10000',
          currency: 'INR',
          settlementDate: '2026-09-25',
          status: 'CAPTURED',
        },
      ],
      statement: [
        {
          externalReference: 'prov-pay-001',
          paymentReference: 'PAY-001',
          amountMinor: '9900',
          currency: 'INR',
          settlementDate: '2026-09-25',
          status: 'CAPTURED',
        },
      ],
    };
    const headers = await token(['reconciliation.read']);
    const before = await database.query('SELECT id FROM reconciliation_cases');
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/reconciliation/runs',
      headers,
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/reconciliation/runs',
      headers,
      payload,
    });

    expect(second.statusCode).toBe(201);
    expect(second.json<{ runId: string }>().runId).toBe(first.json<{ runId: string }>().runId);
    const after = await database.query('SELECT id FROM reconciliation_cases');
    expect(after.rowCount).toBe(before.rowCount);
  });
});
