import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { AcquirerSimulator, ProviderTransportError } from '../../acquirer-simulator/src/simulator';
import { signAccessToken, type PermissionValue } from '@ledgerflow/auth';
import { Database, isInDatabaseTransaction, runMigrations } from '@ledgerflow/database';
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
import { PaymentService } from './payment.service';
import {
  type AcquirerPort,
  type AcquirerRequest,
  type AcquirerResult,
  type LedgerPort,
  type LedgerPostingRequest,
} from './ports';
import { testServiceContext } from './testing/service-context';

const JWT_SECRET = 'payment-test-secret-long-enough-for-hs256';

class ProbingAcquirer implements AcquirerPort {
  callsInsideTransaction = 0;

  constructor(private readonly inner: AcquirerSimulator) {}

  async execute(request: AcquirerRequest): Promise<AcquirerResult> {
    if (isInDatabaseTransaction()) this.callsInsideTransaction += 1;
    try {
      return await this.inner.execute(request);
    } catch (error) {
      if (error instanceof ProviderTransportError) {
        throw Object.assign(new Error(error.message), { name: 'ProviderTransportError', attemptId: request.attemptId });
      }
      throw error;
    }
  }

  lookup(attemptId: string): Promise<AcquirerResult | null> {
    if (isInDatabaseTransaction()) this.callsInsideTransaction += 1;
    return Promise.resolve(this.inner.lookup(attemptId));
  }
}

class MemoryLedger implements LedgerPort {
  readonly journals = new Map<string, string>();
  failNext = false;
  callsInsideTransaction = 0;

  post(request: LedgerPostingRequest): Promise<{ journalId: string }> {
    if (isInDatabaseTransaction()) this.callsInsideTransaction += 1;
    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error('ledger unavailable'));
    }
    const key = `${request.referenceType}:${request.referenceId}`;
    const existing = this.journals.get(key);
    if (existing !== undefined) return Promise.resolve({ journalId: existing });
    const journalId = randomUUID();
    this.journals.set(key, journalId);
    return Promise.resolve({ journalId });
  }
}

let fixture: PostgresFixture;
let database: Database;
let app: NestFastifyApplication;
let simulator: AcquirerSimulator;
let acquirer: ProbingAcquirer;
let ledger: MemoryLedger;

async function auth(permissions: PermissionValue[]): Promise<Record<string, string>> {
  const token = await signAccessToken(
    {
      subject: 'payment-tester',
      actorType: 'USER',
      roles: ['TEST'],
      permissions,
      expiresInSeconds: 600,
    },
    JWT_SECRET,
  );
  return { authorization: `Bearer ${token}` };
}

function idempotency(prefix: string): Record<string, string> {
  return { 'idempotency-key': `${prefix}-${randomUUID()}` };
}

async function createPayment(amountMinor = '10000'): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/payments',
    headers: { ...(await auth(['payments.create'])), ...idempotency('create') },
    payload: { merchantId: randomUUID(), amountMinor, currency: 'INR' },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ id: string }>().id;
}

async function authorize(paymentId: string, key?: string): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: `/api/v1/payments/${paymentId}/authorize`,
    headers: { ...(await auth(['payments.create'])), 'idempotency-key': key ?? `auth-${randomUUID()}` },
  });
}

async function capture(paymentId: string, key?: string, amountMinor?: string): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: `/api/v1/payments/${paymentId}/capture`,
    headers: { ...(await auth(['payments.capture'])), 'idempotency-key': key ?? `cap-${randomUUID()}` },
    payload: amountMinor === undefined ? {} : { amountMinor },
  });
}

beforeAll(async () => {
  fixture = await startPostgres({ database: 'ledgerflow_payment_test' });
  await runMigrations({
    connectionString: fixture.connectionString,
    directory: join(__dirname, '..', 'migrations'),
    serviceName: 'payment-service',
    logger: silentLogger(),
  });
  database = new Database({ connectionString: fixture.connectionString, maxConnections: 20 }, silentLogger());
  simulator = new AcquirerSimulator();
  acquirer = new ProbingAcquirer(simulator);
  ledger = new MemoryLedger();

  app = await createTestApp({
    rootModule: AppModule.register(
      testServiceContext('payment-service'),
      {
        SERVICE_NAME: 'payment-service',
        PAYMENT_DATABASE_URL: fixture.connectionString,
        JWT_SECRET,
        DATABASE_MAX_CONNECTIONS: '20',
      },
      { acquirer, ledger },
    ),
    serviceName: 'payment-service',
    globalPrefix: 'api/v1',
  });
}, 180_000);

afterAll(async () => {
  await app.close();
  await database.close();
  await fixture.stop();
});

beforeEach(async () => {
  simulator.reset();
  ledger.journals.clear();
  ledger.failNext = false;
  acquirer.callsInsideTransaction = 0;
  ledger.callsInsideTransaction = 0;
  await database.query(
    'TRUNCATE outbox_events, ledger_postings, payment_attempts, idempotency_keys, payments, audit_events CASCADE',
  );
});

describe('authorization uncertainty', () => {
  it('keeps the provider call outside the database transaction', async () => {
    const paymentId = await createPayment();
    const response = await authorize(paymentId);

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<{ status: string }>().status).toBe('AUTHORIZED');
    expect(acquirer.callsInsideTransaction).toBe(0);
    expect(ledger.callsInsideTransaction).toBe(0);
  });

  it('moves to AUTHORIZATION_UNKNOWN when the provider succeeds but the response is lost, then resolves once', async () => {
    simulator.setMode('TIMEOUT');
    const paymentId = await createPayment();
    const lost = await authorize(paymentId);

    expect(lost.statusCode, lost.body).toBe(200);
    expect(lost.json<{ status: string; attempts: { status: string }[] }>()).toMatchObject({
      status: 'AUTHORIZATION_UNKNOWN',
      authorizedMinor: '0',
    });
    expect(lost.json<{ attempts: unknown[] }>().attempts).toHaveLength(1);
    expect(lost.json<{ attempts: { status: string }[] }>().attempts[0]?.status).toBe('UNKNOWN');

    const resolved = await app.inject({
      method: 'POST',
      url: `/api/v1/payments/${paymentId}/resolve`,
      headers: await auth(['payments.capture']),
    });

    expect(resolved.statusCode, resolved.body).toBe(200);
    const body = resolved.json<{ status: string; authorizedMinor: string; attempts: { status: string; providerReference: string | null }[] }>();
    expect(body.status).toBe('AUTHORIZED');
    expect(body.authorizedMinor).toBe('10000');
    expect(body.attempts).toHaveLength(1);
    expect(body.attempts[0]?.status).toBe('SUCCEEDED');
    expect(body.attempts[0]?.providerReference).toMatch(/^prov_/);
    expect(ledger.journals.size).toBe(0);
  });

  it('does not apply a duplicate provider result a second time', async () => {
    const paymentId = await createPayment();
    const authorized = await authorize(paymentId);
    const attemptId = authorized.json<{ attempts: { id: string }[] }>().attempts[0]!.id;

    await app.get(PaymentService).redeliverProviderResult(attemptId, {
      outcome: 'APPROVED',
      providerReference: 'prov_again',
      amountMinor: 10000n,
      currency: 'INR',
    });

    const current = await app.inject({
      method: 'GET',
      url: `/api/v1/payments/${paymentId}`,
      headers: await auth(['payments.read']),
    });
    expect(current.json<{ authorizedMinor: string; attempts: unknown[] }>()).toMatchObject({
      status: 'AUTHORIZED',
      authorizedMinor: '10000',
    });
    expect(current.json<{ attempts: unknown[] }>().attempts).toHaveLength(1);
  });

  it('rejects a provider approval whose amount does not match', async () => {
    simulator.setMode('WRONG_AMOUNT');
    const paymentId = await createPayment();
    const response = await authorize(paymentId);

    expect(response.json<{ status: string; attempts: { failureCode: string | null }[] }>().status).toBe(
      'AUTHORIZATION_FAILED',
    );
    expect(response.json<{ attempts: { failureCode: string | null }[] }>().attempts[0]?.failureCode).toBe(
      'PROVIDER_RESPONSE_INVALID',
    );
  });
});

describe('capture, refund and idempotency', () => {
  it('captures once, posts the ledger once, and replays the same idempotency key', async () => {
    const paymentId = await createPayment();
    await authorize(paymentId);
    const key = `cap-${randomUUID()}`;

    const first = await capture(paymentId, key);
    const second = await capture(paymentId, key);

    expect(first.statusCode, first.body).toBe(200);
    expect(first.json<{ status: string; ledgerPostings: { status: string; journalId: string | null }[] }>()).toMatchObject({
      status: 'CAPTURED',
      capturedMinor: '10000',
    });
    expect(first.json<{ ledgerPostings: { status: string }[] }>().ledgerPostings[0]?.status).toBe('POSTED');
    expect(second.json<{ capturedMinor: string; ledgerPostings: { journalId: string | null }[] }>().capturedMinor).toBe('10000');
    expect(second.json<{ ledgerPostings: { journalId: string | null }[] }>().ledgerPostings[0]?.journalId).toBe(
      first.json<{ ledgerPostings: { journalId: string | null }[] }>().ledgerPostings[0]?.journalId,
    );
    expect(ledger.journals.size).toBe(1);
  });

  it('rejects the same idempotency key with a different capture amount', async () => {
    const paymentId = await createPayment('5000');
    await authorize(paymentId);
    const key = `cap-${randomUUID()}`;
    await capture(paymentId, key, '2000');

    const conflict = await capture(paymentId, key, '3000');
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
  });

  it('lets exactly one of several competing captures succeed', async () => {
    const paymentId = await createPayment();
    await authorize(paymentId);

    const responses = await Promise.all(Array.from({ length: 8 }, () => capture(paymentId)));
    const succeeded = responses.filter((response) => response.statusCode === 200);
    expect(succeeded).toHaveLength(1);
    expect(responses.filter((response) => response.statusCode === 409)).toHaveLength(7);

    const current = await app.inject({
      method: 'GET',
      url: `/api/v1/payments/${paymentId}`,
      headers: await auth(['payments.read']),
    });
    expect(current.json<{ capturedMinor: string }>().capturedMinor).toBe('10000');
    expect(ledger.journals.size).toBe(1);
  });

  it('refuses a refund above the captured amount and allows a partial refund', async () => {
    const paymentId = await createPayment();
    await authorize(paymentId);
    await capture(paymentId, `cap-${randomUUID()}`, '8000');

    const tooMuch = await app.inject({
      method: 'POST',
      url: `/api/v1/payments/${paymentId}/refund`,
      headers: { ...(await auth(['payments.refund'])), ...idempotency('refund') },
      payload: { amountMinor: '8001' },
    });
    expect(tooMuch.statusCode).toBe(409);
    expect(tooMuch.json().error.code).toBe('REFUND_EXCEEDS_CAPTURED');

    const partial = await app.inject({
      method: 'POST',
      url: `/api/v1/payments/${paymentId}/refund`,
      headers: { ...(await auth(['payments.refund'])), ...idempotency('refund') },
      payload: { amountMinor: '3000' },
    });
    expect(partial.statusCode, partial.body).toBe(200);
    expect(partial.json<{ status: string; refundedMinor: string }>()).toMatchObject({
      status: 'PARTIALLY_REFUNDED',
      refundedMinor: '3000',
    });
    expect(ledger.journals.size).toBe(2);
  });

  it('leaves the ledger posting pending when the ledger is down, then posts it once', async () => {
    const paymentId = await createPayment();
    await authorize(paymentId);
    ledger.failNext = true;

    const captured = await capture(paymentId);
    expect(captured.json<{ status: string; ledgerPostings: { status: string }[] }>()).toMatchObject({
      status: 'CAPTURED',
    });
    expect(captured.json<{ ledgerPostings: { status: string }[] }>().ledgerPostings[0]?.status).toBe('PENDING');

    const retried = await app.inject({
      method: 'POST',
      url: `/api/v1/payments/${paymentId}/ledger-postings`,
      headers: await auth(['payments.capture']),
    });
    expect(retried.json<{ ledgerPostings: { status: string; journalId: string | null }[] }>().ledgerPostings[0]?.status).toBe(
      'POSTED',
    );
    const journalId = retried.json<{ ledgerPostings: { journalId: string | null }[] }>().ledgerPostings[0]?.journalId;

    await app.inject({
      method: 'POST',
      url: `/api/v1/payments/${paymentId}/ledger-postings`,
      headers: await auth(['payments.capture']),
    });
    expect(ledger.journals.size).toBe(1);
    expect([...ledger.journals.values()]).toEqual([journalId]);
  });

  it('requires an idempotency key', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/payments',
      headers: await auth(['payments.create']),
      payload: { merchantId: randomUUID(), amountMinor: '100', currency: 'INR' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });
});
