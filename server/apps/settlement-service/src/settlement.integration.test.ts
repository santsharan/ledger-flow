import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { signAccessToken } from '@ledgerflow/auth';
import { runMigrations } from '@ledgerflow/database';
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

const JWT_SECRET = 'settlement-test-secret-long-enough-for-hs256';

let fixture: PostgresFixture;
let app: NestFastifyApplication;

async function headers(
  permission: 'settlements.approve' | 'settlements.read',
): Promise<Record<string, string>> {
  const token = await signAccessToken(
    {
      subject: 'finance-tester',
      actorType: 'USER',
      roles: ['FINANCE_OPERATOR'],
      permissions: [permission],
      expiresInSeconds: 600,
    },
    JWT_SECRET,
  );
  return { authorization: `Bearer ${token}` };
}

beforeAll(async () => {
  fixture = await startPostgres({ database: 'ledgerflow_settlement_test' });
  await runMigrations({
    connectionString: fixture.connectionString,
    directory: join(__dirname, '..', 'migrations'),
    serviceName: 'settlement-service',
    logger: silentLogger(),
  });
  app = await createTestApp({
    rootModule: AppModule.register(testServiceContext('settlement-service'), {
      SERVICE_NAME: 'settlement-service',
      SETTLEMENT_DATABASE_URL: fixture.connectionString,
      JWT_SECRET,
    }),
    serviceName: 'settlement-service',
    globalPrefix: 'api/v1',
  });
}, 180_000);

afterAll(async () => {
  await app.close();
  await fixture.stop();
});

describe('settlement calculation', () => {
  it('freezes a reproducible net and refuses a second confirmation', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/settlements',
      headers: await headers('settlements.approve'),
      payload: {
        merchantId: randomUUID(),
        settlementDate: '2026-09-25',
        currency: 'INR',
        feeVersion: 'fee-v1',
        feeBasisPoints: 250,
        fixedFeeMinor: '0',
        items: [
          { itemType: 'CAPTURE', sourceId: 'pay-1', amountMinor: '100000', currency: 'INR' },
          { itemType: 'REFUND', sourceId: 'ref-1', amountMinor: '5000', currency: 'INR' },
        ],
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = created.json<{ id: string }>().id;

    const calculated = await app.inject({
      method: 'POST',
      url: `/api/v1/settlements/${id}/calculate`,
      headers: await headers('settlements.approve'),
    });
    expect(
      calculated.json<{ totals: { gross: string; fees: string; refunds: string; net: string } }>()
        .totals,
    ).toEqual({
      gross: '100000',
      fees: '2500',
      refunds: '5000',
      chargebacks: '0',
      adjustments: '0',
      net: '92500',
    });

    const reproduction = await app.inject({
      method: 'GET',
      url: `/api/v1/settlements/${id}/reproduction`,
      headers: await headers('settlements.read'),
    });
    expect(reproduction.json()).toMatchObject({ matches: true });

    const tooLarge = await app.inject({
      method: 'POST',
      url: `/api/v1/settlements/${id}/approve`,
      headers: await headers('settlements.approve'),
      payload: { reason: 'payable is short', availablePayableMinor: '1000' },
    });
    expect(tooLarge.statusCode).toBe(409);
    expect(tooLarge.json().error.code).toBe('SETTLEMENT_EXCEEDS_PAYABLE');

    const approved = await app.inject({
      method: 'POST',
      url: `/api/v1/settlements/${id}/approve`,
      headers: await headers('settlements.approve'),
      payload: { reason: 'payable covers the net', availablePayableMinor: '92500' },
    });
    expect(approved.json<{ status: string }>().status).toBe('APPROVED');

    await app.inject({
      method: 'POST',
      url: `/api/v1/settlements/${id}/submit`,
      headers: await headers('settlements.approve'),
      payload: { reason: 'sent to acquirer' },
    });
    const confirmed = await app.inject({
      method: 'POST',
      url: `/api/v1/settlements/${id}/confirm`,
      headers: await headers('settlements.approve'),
      payload: { reason: 'acquirer confirmed' },
    });
    expect(confirmed.json<{ status: string }>().status).toBe('CONFIRMED');

    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/settlements/${id}/confirm`,
      headers: await headers('settlements.approve'),
      payload: { reason: 'duplicate confirmation' },
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('SETTLEMENT_ALREADY_CONFIRMED');

    const reversed = await app.inject({
      method: 'POST',
      url: `/api/v1/settlements/${id}/reverse`,
      headers: await headers('settlements.approve'),
      payload: { reason: 'payout returned' },
    });
    expect(reversed.json<{ status: string }>().status).toBe('REVERSED');
  });

  it('rejects the same capture in a second batch and can fail an unknown settlement', async () => {
    const merchantId = randomUUID();
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/settlements',
      headers: await headers('settlements.approve'),
      payload: batchPayload(merchantId, '2026-09-01', 'pay-shared'),
    });
    expect(first.statusCode, first.body).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/settlements',
      headers: await headers('settlements.approve'),
      payload: batchPayload(merchantId, '2026-09-02', 'pay-shared'),
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('UNIQUE_VIOLATION');

    const other = await app.inject({
      method: 'POST',
      url: '/api/v1/settlements',
      headers: await headers('settlements.approve'),
      payload: batchPayload(merchantId, '2026-09-03', 'pay-other'),
    });
    const otherId = other.json<{ id: string }>().id;
    await app.inject({
      method: 'POST',
      url: `/api/v1/settlements/${otherId}/calculate`,
      headers: await headers('settlements.approve'),
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/settlements/${otherId}/approve`,
      headers: await headers('settlements.approve'),
      payload: { reason: 'within payable', availablePayableMinor: '97500' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/settlements/${otherId}/submit`,
      headers: await headers('settlements.approve'),
      payload: { reason: 'submitted' },
    });
    const unknown = await app.inject({
      method: 'POST',
      url: `/api/v1/settlements/${otherId}/unknown`,
      headers: await headers('settlements.approve'),
      payload: { reason: 'acquirer timed out' },
    });
    expect(unknown.json<{ status: string }>().status).toBe('SETTLEMENT_UNKNOWN');
    const failed = await app.inject({
      method: 'POST',
      url: `/api/v1/settlements/${otherId}/fail`,
      headers: await headers('settlements.approve'),
      payload: { reason: 'acquirer reports it was not submitted' },
    });
    expect(failed.json<{ status: string }>().status).toBe('FAILED');
  });
});

function batchPayload(
  merchantId: string,
  settlementDate: string,
  sourceId: string,
): Record<string, unknown> {
  return {
    merchantId,
    settlementDate,
    currency: 'INR',
    feeVersion: 'fee-v1',
    feeBasisPoints: 250,
    fixedFeeMinor: '0',
    items: [{ itemType: 'CAPTURE', sourceId, amountMinor: '100000', currency: 'INR' }],
  };
}
