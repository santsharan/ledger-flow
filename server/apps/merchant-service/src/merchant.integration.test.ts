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
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from './app.module';
import { testServiceContext } from './testing/service-context';

const JWT_SECRET = 'merchant-test-secret-long-enough-for-hs256';

let fixture: PostgresFixture;
let database: Database;
let app: NestFastifyApplication;

async function tokenFor(
  permissions: PermissionValue[],
  merchantId?: string,
): Promise<Record<string, string>> {
  const token = await signAccessToken(
    {
      subject: 'user-under-test',
      actorType: 'USER',
      roles: ['TEST'],
      permissions,
      ...(merchantId === undefined ? {} : { merchantId }),
      expiresInSeconds: 300,
    },
    JWT_SECRET,
  );

  return { authorization: `Bearer ${token}` };
}

async function createMerchant(overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants',
    headers: await tokenFor(['merchants.write']),
    payload: {
      legalName: `Acme Payments ${randomUUID().slice(0, 8)}`,
      displayName: 'Acme',
      country: 'IN',
      contactEmail: 'ops@acme.test',
      settlementCurrency: 'INR',
      feeBasisPoints: 250,
      fixedFeeMinor: '200',
      ...overrides,
    },
  });

  expect(response.statusCode).toBe(201);
  return response.json<{ id: string }>().id;
}

beforeAll(async () => {
  fixture = await startPostgres({ database: 'ledgerflow_merchant_test' });

  await runMigrations({
    connectionString: fixture.connectionString,
    directory: join(__dirname, '..', 'migrations'),
    serviceName: 'merchant-service',
    logger: silentLogger(),
  });

  database = new Database({ connectionString: fixture.connectionString }, silentLogger());

  app = await createTestApp({
    rootModule: AppModule.register(testServiceContext('merchant-service'), {
      SERVICE_NAME: 'merchant-service',
      MERCHANT_DATABASE_URL: fixture.connectionString,
      JWT_SECRET,
    }),
    serviceName: 'merchant-service',
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
    'TRUNCATE merchant_ledger_accounts, merchant_status_history, merchant_settlement_config, merchants CASCADE',
  );
});

describe('onboarding', () => {
  it('creates a merchant in PENDING with a settlement configuration', async () => {
    const merchantId = await createMerchant();

    const merchant = await app.inject({
      method: 'GET',
      url: `/api/v1/merchants/${merchantId}`,
      headers: await tokenFor(['merchants.read']),
    });

    expect(merchant.json()).toMatchObject({
      status: 'MERCHANT_PENDING',
      settlementCurrency: 'INR',
      country: 'IN',
    });

    const config = await app.inject({
      method: 'GET',
      url: `/api/v1/merchants/${merchantId}/settlement-config`,
      headers: await tokenFor(['merchants.read']),
    });

    expect(config.json()).toMatchObject({
      feeBasisPoints: 250,
      fixedFeeMinor: '200',
      settlementSchedule: 'DAILY',
      currency: 'INR',
    });
  });

  it('rejects an unsupported settlement currency', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/merchants',
      headers: await tokenFor(['merchants.write']),
      payload: {
        legalName: 'Unsupported Currency Ltd',
        displayName: 'UC',
        country: 'IN',
        contactEmail: 'ops@uc.test',
        settlementCurrency: 'XYZ',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('UNSUPPORTED_CURRENCY');
  });

  it('rejects a duplicate legal name in the same country', async () => {
    await createMerchant({ legalName: 'Duplicate Traders' });

    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/merchants',
      headers: await tokenFor(['merchants.write']),
      payload: {
        legalName: 'duplicate traders',
        displayName: 'Dup',
        country: 'IN',
        contactEmail: 'ops@dup.test',
        settlementCurrency: 'INR',
      },
    });

    expect(duplicate.statusCode).toBe(409);
  });
});

describe('status transitions', () => {
  it('activates, suspends and reactivates with an audit trail', async () => {
    const merchantId = await createMerchant();
    const headers = await tokenFor(['merchants.write']);

    for (const [action, expected] of [
      ['activate', 'MERCHANT_ACTIVE'],
      ['suspend', 'MERCHANT_SUSPENDED'],
      ['activate', 'MERCHANT_ACTIVE'],
    ] as const) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/merchants/${merchantId}/${action}`,
        headers,
        payload: { reason: `test ${action}` },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<{ status: string }>().status).toBe(expected);
    }

    const history = await database.query<{ previous_status: string; new_status: string }>(
      'SELECT previous_status, new_status FROM merchant_status_history WHERE merchant_id = $1 ORDER BY created_at',
      [merchantId],
    );
    expect(history.rows).toEqual([
      { previous_status: 'MERCHANT_PENDING', new_status: 'MERCHANT_ACTIVE' },
      { previous_status: 'MERCHANT_ACTIVE', new_status: 'MERCHANT_SUSPENDED' },
      { previous_status: 'MERCHANT_SUSPENDED', new_status: 'MERCHANT_ACTIVE' },
    ]);

    const audit = await database.query('SELECT action FROM audit_events');
    expect(audit.rowCount).toBeGreaterThanOrEqual(4);
  });

  it('refuses to reopen a closed merchant', async () => {
    const merchantId = await createMerchant();
    const headers = await tokenFor(['merchants.write']);

    await app.inject({
      method: 'POST',
      url: `/api/v1/merchants/${merchantId}/close`,
      headers,
      payload: { reason: 'merchant requested closure' },
    });

    const reopen = await app.inject({
      method: 'POST',
      url: `/api/v1/merchants/${merchantId}/activate`,
      headers,
      payload: { reason: 'attempt to reopen' },
    });

    expect(reopen.statusCode).toBe(409);
    expect(reopen.json().error.details).toMatchObject({
      from: 'MERCHANT_CLOSED',
      to: 'MERCHANT_ACTIVE',
    });
  });

  it('requires a reason for every status change', async () => {
    const merchantId = await createMerchant();

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/merchants/${merchantId}/suspend`,
      headers: await tokenFor(['merchants.write']),
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it('lets only one of several concurrent transitions win', async () => {
    const merchantId = await createMerchant();
    const headers = await tokenFor(['merchants.write']);

    // Ten simultaneous activations: the row lock plus the state machine mean exactly one
    // transition happens and the rest see a closed door.
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        app.inject({
          method: 'POST',
          url: `/api/v1/merchants/${merchantId}/activate`,
          headers,
          payload: { reason: 'concurrent activation' },
        }),
      ),
    );

    expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.statusCode === 409)).toHaveLength(9);

    const history = await database.query('SELECT 1 FROM merchant_status_history WHERE merchant_id = $1', [
      merchantId,
    ]);
    expect(history.rowCount).toBe(1);
  });
});

describe('authorization and tenancy', () => {
  it('rejects a caller without merchants.write', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/merchants',
      headers: await tokenFor(['merchants.read']),
      payload: {
        legalName: 'No Permission Ltd',
        displayName: 'NP',
        country: 'IN',
        contactEmail: 'ops@np.test',
        settlementCurrency: 'INR',
      },
    });

    expect(response.statusCode).toBe(403);
  });

  it('stops a merchant-scoped caller from reading another merchant', async () => {
    const merchantId = await createMerchant();
    const otherMerchantId = await createMerchant({ legalName: 'Other Merchant Ltd' });

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/merchants/${otherMerchantId}`,
      headers: await tokenFor(['merchants.read'], merchantId),
    });

    expect(response.statusCode).toBe(403);
  });

  it('limits a merchant-scoped listing to its own merchant', async () => {
    const merchantId = await createMerchant();
    await createMerchant({ legalName: 'Another Merchant Ltd' });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/merchants',
      headers: await tokenFor(['merchants.read'], merchantId),
    });

    const body = response.json<{ merchants: { id: string }[] }>();
    expect(body.merchants).toHaveLength(1);
    expect(body.merchants[0]!.id).toBe(merchantId);
  });
});

describe('settlement configuration', () => {
  it('updates fees and records the previous values with a reason', async () => {
    const merchantId = await createMerchant();

    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/merchants/${merchantId}/settlement-config`,
      headers: await tokenFor(['merchants.write']),
      payload: {
        settlementSchedule: 'WEEKLY',
        feeBasisPoints: 190,
        fixedFeeMinor: '500',
        holdPeriodDays: 2,
        reason: 'negotiated rate for volume commitment',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ feeBasisPoints: 190, settlementSchedule: 'WEEKLY' });

    const audit = await database.query<{
      before_state: { feeBasisPoints: number };
      after_state: { feeBasisPoints: number };
      reason: string;
    }>(`SELECT before_state, after_state, reason FROM audit_events
        WHERE action = 'merchant.settlement_config.updated'`);

    expect(audit.rows[0]!.before_state.feeBasisPoints).toBe(250);
    expect(audit.rows[0]!.after_state.feeBasisPoints).toBe(190);
    expect(audit.rows[0]!.reason).toBe('negotiated rate for volume commitment');
  });

  it('rejects a fee outside the allowed range', async () => {
    const merchantId = await createMerchant();

    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/merchants/${merchantId}/settlement-config`,
      headers: await tokenFor(['merchants.write']),
      payload: {
        settlementSchedule: 'DAILY',
        feeBasisPoints: 20_000,
        fixedFeeMinor: '0',
        holdPeriodDays: 0,
        reason: 'attempted out-of-range fee',
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a fractional fee amount — money is integer minor units', async () => {
    const merchantId = await createMerchant();

    const response = await app.inject({
      method: 'PUT',
      url: `/api/v1/merchants/${merchantId}/settlement-config`,
      headers: await tokenFor(['merchants.write']),
      payload: {
        settlementSchedule: 'DAILY',
        feeBasisPoints: 250,
        fixedFeeMinor: '2.50',
        holdPeriodDays: 0,
        reason: 'attempted decimal amount',
      },
    });

    expect(response.statusCode).toBe(400);
  });
});
