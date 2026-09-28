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

const JWT_SECRET = 'risk-test-secret-long-enough-for-hs256-ok';

let fixture: PostgresFixture;
let database: Database;
let app: NestFastifyApplication;

beforeAll(async () => {
  fixture = await startPostgres({ database: 'ledgerflow_risk_test' });
  await runMigrations({
    connectionString: fixture.connectionString,
    directory: join(__dirname, '..', 'migrations'),
    serviceName: 'risk-service',
    logger: silentLogger(),
  });
  database = new Database({ connectionString: fixture.connectionString }, silentLogger());
  app = await createTestApp({
    rootModule: AppModule.register(testServiceContext('risk-service'), {
      SERVICE_NAME: 'risk-service',
      RISK_DATABASE_URL: fixture.connectionString,
      JWT_SECRET,
    }),
    serviceName: 'risk-service',
    globalPrefix: 'api/v1',
  });
}, 180_000);

afterAll(async () => {
  await app.close();
  await database.close();
  await fixture.stop();
});

describe('risk evaluations', () => {
  it('persists a deterministic decision and does not rewrite it', async () => {
    const token = await signAccessToken(
      {
        subject: 'risk-analyst',
        actorType: 'USER',
        roles: ['RISK_ANALYST'],
        permissions: ['risk.read'],
        expiresInSeconds: 600,
      },
      JWT_SECRET,
    );
    const payload = {
      amountMinor: '10000',
      currency: 'INR',
      merchantAgeDays: 90,
      merchantRecentCount: 1,
      customerRecentCount: 1,
      historicalTransactionCount: 3,
      failedAttempts: 0,
      country: 'IN',
      ipRisk: 'LOW',
      deviceRisk: 'LOW',
    };

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/risk/evaluations',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/risk/evaluations',
      headers: { authorization: `Bearer ${token}` },
      payload,
    });

    expect(first.statusCode, first.body).toBe(200);
    expect(first.json<{ decision: string; engine: string; riskScore: number }>()).toMatchObject({
      decision: 'APPROVE',
      engine: 'rules',
      riskScore: 0,
    });
    expect(second.json<{ decision: string; riskScore: number }>().decision).toBe(
      first.json<{ decision: string }>().decision,
    );
    expect(second.json<{ id: string }>().id).not.toBe(first.json<{ id: string }>().id);

    const rows = await database.query<{ decision: string }>(
      'SELECT decision FROM risk_evaluations',
    );
    expect(rows.rowCount).toBe(2);
    await expect(
      database.query(`UPDATE risk_evaluations SET decision = 'DECLINE'`),
    ).rejects.toThrow();
  });
});
