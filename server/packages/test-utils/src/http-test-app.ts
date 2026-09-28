import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { BaseConfigSchema, loadConfig, type BaseConfig } from '@ledgerflow/config';
import { createLogger } from '@ledgerflow/logger';
import {
  AppErrorFilter,
  newCorrelationId,
  runWithRequestContext,
  type EntryModule,
} from '@ledgerflow/service-core';

export interface TestAppOptions {
  readonly rootModule: EntryModule;
  readonly serviceName?: string;
  readonly globalPrefix?: string;
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * Boots a real Fastify HTTP server wired the same way `bootstrapService` wires production,
 * so tests exercise the actual filter, hooks and routing rather than a mock.
 */
export async function createTestApp(options: TestAppOptions): Promise<NestFastifyApplication> {
  const config: BaseConfig = loadConfig(BaseConfigSchema, {
    SERVICE_NAME: options.serviceName ?? 'test-service',
    LEDGERFLOW_ENV: 'test',
    LOG_LEVEL: 'fatal',
    ...options.env,
  });

  const logger = createLogger({
    service: config.SERVICE_NAME,
    environment: config.LEDGERFLOW_ENV,
    level: config.LOG_LEVEL,
  });

  const moduleRef = await Test.createTestingModule({ imports: [options.rootModule] }).compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ bodyLimit: config.MAX_REQUEST_BODY_BYTES }),
    { logger: false },
  );

  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', (request, _reply, done) => {
      runWithRequestContext(
        { requestId: String(request.id), correlationId: newCorrelationId() },
        done,
      );
    });

  app.useGlobalFilters(new AppErrorFilter(logger));

  if (options.globalPrefix !== undefined) {
    app.setGlobalPrefix(options.globalPrefix, { exclude: ['health/live', 'health/ready'] });
  }

  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return app;
}
