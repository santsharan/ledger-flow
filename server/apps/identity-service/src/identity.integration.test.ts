import { join } from 'node:path';
import { hashPassword } from '@ledgerflow/auth';
import { Database, runMigrations } from '@ledgerflow/database';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { type LightMyRequestResponse } from 'fastify';
import { createTestApp, silentLogger, startPostgres, type PostgresFixture } from '@ledgerflow/test-utils';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from './app.module';
import { testServiceContext } from './testing/service-context';

const JWT_SECRET = 'test-secret-that-is-long-enough-for-hs256-usage';
const PASSWORD = 'correct-horse-battery-staple';

let fixture: PostgresFixture;
let database: Database;
let app: NestFastifyApplication;

async function seedUser(input: {
  email: string;
  roles: string[];
  merchantId?: string;
}): Promise<string> {
  const passwordHash = await hashPassword(PASSWORD);

  const user = await database.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name, merchant_id)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [input.email, passwordHash, 'Test User', input.merchantId ?? null],
  );

  const userId = user.rows[0]!.id;

  for (const role of input.roles) {
    await database.query(
      'INSERT INTO user_roles (user_id, role_name, granted_by) VALUES ($1, $2, $3)',
      [userId, role, 'test-seed'],
    );
  }

  return userId;
}

async function login(email: string, password = PASSWORD): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  });
}

beforeAll(async () => {
  fixture = await startPostgres({ database: 'ledgerflow_identity_test' });

  await runMigrations({
    connectionString: fixture.connectionString,
    directory: join(__dirname, '..', 'migrations'),
    serviceName: 'identity-service',
    logger: silentLogger(),
  });

  database = new Database({ connectionString: fixture.connectionString }, silentLogger());

  app = await createTestApp({
    rootModule: AppModule.register(testServiceContext('identity-service'), {
      SERVICE_NAME: 'identity-service',
      IDENTITY_DATABASE_URL: fixture.connectionString,
      JWT_SECRET,
    }),
    serviceName: 'identity-service',
    globalPrefix: 'api/v1',
  });
}, 180_000);

afterAll(async () => {
  await app.close();
  await database.close();
  await fixture.stop();
});

beforeEach(async () => {
  await database.query('DELETE FROM refresh_tokens');
  await database.query('DELETE FROM revoked_access_tokens');
  await database.query('DELETE FROM user_roles');
  await database.query('DELETE FROM users');
});

describe('login', () => {
  it('issues an access token carrying resolved permissions', async () => {
    await seedUser({ email: 'admin@ledgerflow.test', roles: ['PLATFORM_ADMIN'] });

    const response = await login('admin@ledgerflow.test');

    expect(response.statusCode).toBe(200);
    const body = response.json<{ accessToken: string; refreshToken: string; expiresIn: number }>();
    expect(body.accessToken.split('.')).toHaveLength(3);
    expect(body.refreshToken).toMatch(/^rt_/);

    const claims = JSON.parse(
      Buffer.from(body.accessToken.split('.')[1]!, 'base64url').toString(),
    ) as { permissions: string[]; roles: string[]; merchantId?: string };

    expect(claims.roles).toEqual(['PLATFORM_ADMIN']);
    expect(claims.permissions).toContain('users.write');
    expect(claims.permissions).not.toContain('payments.capture');
  });

  it('scopes a merchant user to its merchant', async () => {
    const merchantId = '11111111-1111-4111-8111-111111111111';
    await seedUser({ email: 'ops@merchant.test', roles: ['MERCHANT_OPERATOR'], merchantId });

    const claims = JSON.parse(
      Buffer.from((await login('ops@merchant.test')).json<{ accessToken: string }>().accessToken.split('.')[1]!, 'base64url').toString(),
    ) as { merchantId?: string; permissions: string[] };

    expect(claims.merchantId).toBe(merchantId);
    expect(claims.permissions).toContain('payments.capture');
    expect(claims.permissions).not.toContain('settlements.approve');
  });

  it('rejects a wrong password without revealing whether the account exists', async () => {
    await seedUser({ email: 'known@ledgerflow.test', roles: ['SUPPORT'] });

    const wrongPassword = await login('known@ledgerflow.test', 'not-the-right-password');
    const unknownUser = await login('unknown@ledgerflow.test', 'not-the-right-password');

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownUser.statusCode).toBe(401);
    expect(wrongPassword.json().error.message).toBe(unknownUser.json().error.message);
  });

  it('locks an account after repeated failures', async () => {
    await seedUser({ email: 'target@ledgerflow.test', roles: ['SUPPORT'] });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await login('target@ledgerflow.test', 'wrong-password-attempt');
    }

    // Even the correct password is refused once the account is locked.
    const afterLock = await login('target@ledgerflow.test');
    expect(afterLock.statusCode).toBe(403);

    const status = await database.query<{ status: string }>(
      'SELECT status FROM users WHERE email = $1',
      ['target@ledgerflow.test'],
    );
    expect(status.rows[0]!.status).toBe('LOCKED');
  });

  it('never stores the password in plaintext', async () => {
    await seedUser({ email: 'hash@ledgerflow.test', roles: ['SUPPORT'] });

    const stored = await database.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE email = $1',
      ['hash@ledgerflow.test'],
    );

    expect(stored.rows[0]!.password_hash).not.toContain(PASSWORD);
    expect(stored.rows[0]!.password_hash.startsWith('scrypt$')).toBe(true);
  });
});

describe('authorization', () => {
  it('rejects an unauthenticated request with the platform error envelope', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a caller without the required permission', async () => {
    await seedUser({ email: 'support@ledgerflow.test', roles: ['SUPPORT'] });
    const { accessToken } = (await login('support@ledgerflow.test')).json<{ accessToken: string }>();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        email: 'new@ledgerflow.test',
        password: 'another-long-enough-password',
        fullName: 'New User',
        roles: ['SUPPORT'],
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toMatchObject({
      code: 'FORBIDDEN',
      details: { required: 'users.write' },
    });
  });

  it('rejects a tampered token', async () => {
    await seedUser({ email: 'admin2@ledgerflow.test', roles: ['PLATFORM_ADMIN'] });
    const { accessToken } = (await login('admin2@ledgerflow.test')).json<{ accessToken: string }>();

    const [header, payload, signature] = accessToken.split('.');
    const forged = JSON.parse(Buffer.from(payload!, 'base64url').toString()) as Record<
      string,
      unknown
    >;
    forged.permissions = ['users.write', 'admin.operations'];
    const tampered = `${header}.${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${signature}`;

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${tampered}` },
    });

    expect(response.statusCode).toBe(401);
  });

  it('stops accepting an access token after logout', async () => {
    await seedUser({ email: 'logout@ledgerflow.test', roles: ['SUPPORT'] });
    const { accessToken } = (await login('logout@ledgerflow.test')).json<{ accessToken: string }>();
    const authorization = `Bearer ${accessToken}`;

    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization } })).statusCode).toBe(200);

    const loggedOut = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { authorization },
    });
    expect(loggedOut.statusCode).toBe(204);

    const afterLogout = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization },
    });
    expect(afterLogout.statusCode).toBe(401);
  });
});

describe('refresh token rotation', () => {
  it('issues a new pair and invalidates the presented token', async () => {
    await seedUser({ email: 'rotate@ledgerflow.test', roles: ['SUPPORT'] });
    const { refreshToken } = (await login('rotate@ledgerflow.test')).json<{ refreshToken: string }>();

    const refreshed = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken },
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json<{ refreshToken: string }>().refreshToken).not.toBe(refreshToken);

    // The old token is dead — replaying it is exactly what a stolen token looks like.
    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken },
    });
    expect(replay.statusCode).toBe(401);
  });

  it('lets only one of two concurrent refreshes succeed', async () => {
    await seedUser({ email: 'race@ledgerflow.test', roles: ['SUPPORT'] });
    const { refreshToken } = (await login('race@ledgerflow.test')).json<{ refreshToken: string }>();

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        app.inject({ method: 'POST', url: '/api/v1/auth/refresh', payload: { refreshToken } }),
      ),
    );

    expect(results.filter((response) => response.statusCode === 200)).toHaveLength(1);
  });
});

describe('user management', () => {
  it('creates a user and writes an audit record without the password', async () => {
    await seedUser({ email: 'root@ledgerflow.test', roles: ['PLATFORM_ADMIN'] });
    const { accessToken } = (await login('root@ledgerflow.test')).json<{ accessToken: string }>();

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        email: 'finance@ledgerflow.test',
        password: 'a-sufficiently-long-password',
        fullName: 'Finance Operator',
        roles: ['FINANCE_OPERATOR'],
      },
    });

    expect(created.statusCode).toBe(201);
    expect(created.json<{ permissions: string[] }>().permissions).toContain('settlements.approve');

    const audit = await database.query<{ action: string; after_state: Record<string, unknown> }>(
      `SELECT action, after_state FROM audit_events WHERE action = 'user.created'`,
    );
    expect(audit.rowCount).toBe(1);
    expect(JSON.stringify(audit.rows[0]!.after_state)).not.toContain('sufficiently-long-password');
  });

  it('rejects a duplicate email', async () => {
    await seedUser({ email: 'root2@ledgerflow.test', roles: ['PLATFORM_ADMIN'] });
    const { accessToken } = (await login('root2@ledgerflow.test')).json<{ accessToken: string }>();

    const payload = {
      email: 'duplicate@ledgerflow.test',
      password: 'a-sufficiently-long-password',
      fullName: 'Duplicate',
      roles: ['SUPPORT'],
    };
    const headers = { authorization: `Bearer ${accessToken}` };

    expect((await app.inject({ method: 'POST', url: '/api/v1/users', headers, payload })).statusCode).toBe(201);
    const second = await app.inject({ method: 'POST', url: '/api/v1/users', headers, payload });

    expect(second.statusCode).toBe(409);
  });

  it('rejects a malformed request body with field-level detail', async () => {
    await seedUser({ email: 'root3@ledgerflow.test', roles: ['PLATFORM_ADMIN'] });
    const { accessToken } = (await login('root3@ledgerflow.test')).json<{ accessToken: string }>();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { email: 'not-an-email', password: 'short', fullName: '', roles: [] },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_FAILED');
    expect(response.json().error.details.issues.length).toBeGreaterThan(0);
  });
});

describe('audit trail', () => {
  it('is append-only', async () => {
    await seedUser({ email: 'audit@ledgerflow.test', roles: ['SUPPORT'] });
    await login('audit@ledgerflow.test');

    await expect(
      database.query(`UPDATE audit_events SET action = 'tampered'`),
    ).rejects.toThrow();
    await expect(database.query('DELETE FROM audit_events')).rejects.toThrow();
  });
});
