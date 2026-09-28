import { createTestApp } from '@ledgerflow/test-utils';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from './app.module';
import { testServiceContext } from './testing/service-context';

describe('api-gateway', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createTestApp({
      rootModule: AppModule.register(testServiceContext('api-gateway')),
      serviceName: 'api-gateway',
      globalPrefix: 'api/v1',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports liveness', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/live' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'up', service: 'api-gateway' });
  });

  it('reports readiness', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'up', service: 'api-gateway' });
  });

  it('returns the platform error envelope for an unknown route', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/does-not-exist' });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toMatchObject({ code: 'NOT_FOUND' });
    expect(response.json().error.requestId).toBeTypeOf('string');
  });
});
