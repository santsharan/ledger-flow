import 'reflect-metadata';
import helmet from '@fastify/helmet';
import { type DynamicModule, type INestApplication, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { BaseConfigSchema, loadConfig, type BaseConfig } from '@ledgerflow/config';
import { createLogger, type Logger } from '@ledgerflow/logger';
import { startTelemetry } from '@ledgerflow/observability';
import { AppErrorFilter } from './app-error.filter';
import { ServiceState } from './health/service-state';
import {
  CORRELATION_ID_HEADER,
  newCorrelationId,
  newRequestId,
  REQUEST_ID_HEADER,
  runWithRequestContext,
} from './request-context';

/** A Nest entry module: either a plain module class or a configured dynamic module. */
export type EntryModule = Type<unknown> | DynamicModule;

export interface CreateAppOptions {
  readonly rootModule: EntryModule;
  readonly config: BaseConfig;
  readonly logger: Logger;
  /** Path prefix for business routes. Health endpoints are always unprefixed. */
  readonly globalPrefix?: string;
}

export async function createServiceApp(options: CreateAppOptions): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    bodyLimit: options.config.MAX_REQUEST_BODY_BYTES,
    trustProxy: true,
    genReqId: () => newRequestId(),
  });

  const app = await NestFactory.create<NestFastifyApplication>(options.rootModule, adapter, {
    logger: false,
    bufferLogs: true,
  });

  await app.register(helmet, { contentSecurityPolicy: false });

  // Establish correlation identifiers before anything else runs, so every log line and
  // downstream call in this request shares them (specification §70).
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onRequest', (request, reply, done) => {
    const headerRequestId = request.headers[REQUEST_ID_HEADER];
    const headerCorrelationId = request.headers[CORRELATION_ID_HEADER];

    const requestId = typeof headerRequestId === 'string' ? headerRequestId : String(request.id);
    const correlationId =
      typeof headerCorrelationId === 'string' ? headerCorrelationId : newCorrelationId();

    void reply.header(REQUEST_ID_HEADER, requestId);
    void reply.header(CORRELATION_ID_HEADER, correlationId);

    runWithRequestContext({ requestId, correlationId }, done);
  });

  app.useGlobalFilters(new AppErrorFilter(options.logger));

  if (options.globalPrefix !== undefined) {
    app.setGlobalPrefix(options.globalPrefix, {
      exclude: ['health/live', 'health/ready'],
    });
  }

  return app;
}

export interface ServiceContext {
  readonly config: BaseConfig;
  readonly logger: Logger;
}

export interface BootstrapOptions {
  readonly serviceName: string;
  /**
   * Built after configuration is validated, so the root module receives real config and a
   * real logger instead of reading `process.env` from inside the module graph.
   */
  readonly createRootModule: (context: ServiceContext) => EntryModule;
  readonly globalPrefix?: string;
}

export async function bootstrapService(options: BootstrapOptions): Promise<NestFastifyApplication> {
  const config = loadConfig(BaseConfigSchema, {
    ...process.env,
    SERVICE_NAME: process.env.SERVICE_NAME ?? options.serviceName,
  });

  startTelemetry(config.SERVICE_NAME);

  const logger = createLogger({
    service: config.SERVICE_NAME,
    environment: config.LEDGERFLOW_ENV,
    level: config.LOG_LEVEL,
    pretty: config.LOG_PRETTY,
  });

  const app = await createServiceApp({
    rootModule: options.createRootModule({ config, logger }),
    config,
    logger,
    ...(options.globalPrefix === undefined ? {} : { globalPrefix: options.globalPrefix }),
  });

  registerShutdownHandlers(app, logger, config.SHUTDOWN_TIMEOUT_MS);

  await app.listen({ port: config.PORT, host: config.HOST });
  logger.info(
    { event: 'service.started', port: config.PORT, host: config.HOST },
    `${config.SERVICE_NAME} listening on ${config.HOST}:${config.PORT}`,
  );

  return app;
}

/**
 * Shutdown order matters for a financial system: stop advertising readiness, let in-flight
 * work commit, and only then tear down clients (failure-model.md §6).
 */
export function registerShutdownHandlers(
  app: INestApplication,
  logger: Logger,
  timeoutMs: number,
): void {
  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ event: 'service.shutdown.started', signal }, 'shutting down');

    const forceExit = setTimeout(() => {
      logger.error({ event: 'service.shutdown.timeout', timeoutMs }, 'forcing exit');
      process.exit(1);
    }, timeoutMs);
    forceExit.unref();

    void (async (): Promise<void> => {
      try {
        app.get(ServiceState).markShuttingDown();
        await app.close();
        logger.info({ event: 'service.shutdown.completed' }, 'shutdown complete');
        process.exit(0);
      } catch (error) {
        logger.error({ event: 'service.shutdown.failed', err: error }, 'shutdown failed');
        process.exit(1);
      }
    })();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
