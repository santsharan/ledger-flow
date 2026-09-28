#!/usr/bin/env node
/**
 * Generates a LedgerFlow service from the base template.
 *
 * Usage: node scripts/scaffold-service.mjs <service-name> <port> ["description"]
 *
 * The generated service has no business logic: configuration, logging, health endpoints,
 * the error envelope and graceful shutdown only. Everything else is added by its phase.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function write(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

export function scaffoldService({ name, port, description }) {
  const dir = join(ROOT, 'apps', name);

  if (existsSync(join(dir, 'package.json'))) {
    console.log(`skip ${name} (already exists)`);
    return;
  }

  write(
    join(dir, 'package.json'),
    `${JSON.stringify(
      {
        name: `@ledgerflow/${name}`,
        version: '0.1.0',
        private: true,
        main: 'dist/main.js',
        scripts: {
          build: 'tsc -p tsconfig.json',
          start: 'node dist/main.js',
          'start:dev': 'node --watch -r ts-node/register src/main.ts',
        },
        dependencies: {
          '@ledgerflow/config': 'workspace:*',
          '@ledgerflow/errors': 'workspace:*',
          '@ledgerflow/logger': 'workspace:*',
          '@ledgerflow/service-core': 'workspace:*',
          '@nestjs/common': '^11.0.0',
          '@nestjs/core': '^11.0.0',
          '@nestjs/platform-fastify': '^11.0.0',
          'reflect-metadata': '^0.2.2',
          rxjs: '^7.8.1',
        },
        devDependencies: {
          '@ledgerflow/test-utils': 'workspace:*',
        },
      },
      null,
      2,
    )}\n`,
  );

  write(
    join(dir, 'tsconfig.json'),
    `${JSON.stringify(
      {
        extends: '../../tsconfig.base.json',
        compilerOptions: { rootDir: 'src', outDir: 'dist' },
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.test.ts'],
      },
      null,
      2,
    )}\n`,
  );

  write(
    join(dir, 'src/app.module.ts'),
    `import { type DynamicModule, Module } from '@nestjs/common';
import { CoreModule, type ServiceContext } from '@ledgerflow/service-core';

/**
 * ${description}
 */
@Module({})
export class AppModule {
  static register(context: ServiceContext): DynamicModule {
    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot({
          serviceName: '${name}',
          config: context.config,
          logger: context.logger,
        }),
      ],
    };
  }
}
`,
  );

  write(
    join(dir, 'src/main.ts'),
    `import { bootstrapService } from '@ledgerflow/service-core';
import { AppModule } from './app.module';

void bootstrapService({
  serviceName: '${name}',
  createRootModule: (context) => AppModule.register(context),
  globalPrefix: 'api/v1',
});
`,
  );

  write(
    join(dir, 'src/app.module.test.ts'),
    `import { createTestApp } from '@ledgerflow/test-utils';
import { type NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from './app.module';
import { testServiceContext } from './testing/service-context';

describe('${name}', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createTestApp({
      rootModule: AppModule.register(testServiceContext('${name}')),
      serviceName: '${name}',
      globalPrefix: 'api/v1',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports liveness', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/live' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'up', service: '${name}' });
  });

  it('reports readiness', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'up', service: '${name}' });
  });

  it('returns the platform error envelope for an unknown route', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/does-not-exist' });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toMatchObject({ code: 'NOT_FOUND' });
    expect(response.json().error.requestId).toBeTypeOf('string');
  });
});
`,
  );

  write(
    join(dir, 'src/testing/service-context.ts'),
    `import { BaseConfigSchema, loadConfig } from '@ledgerflow/config';
import { createLogger } from '@ledgerflow/logger';
import { type ServiceContext } from '@ledgerflow/service-core';

/** Builds the same context \`bootstrapService\` builds, for use in tests. */
export function testServiceContext(
  serviceName: string,
  env: NodeJS.ProcessEnv = {},
): ServiceContext {
  const config = loadConfig(BaseConfigSchema, {
    SERVICE_NAME: serviceName,
    LEDGERFLOW_ENV: 'test',
    LOG_LEVEL: 'fatal',
    ...env,
  });

  return {
    config,
    logger: createLogger({
      service: config.SERVICE_NAME,
      environment: config.LEDGERFLOW_ENV,
      level: config.LOG_LEVEL,
    }),
  };
}
`,
  );

  write(
    join(dir, '.env.example'),
    `SERVICE_NAME=${name}
PORT=${port}
LOG_LEVEL=info
LOG_PRETTY=true
LEDGERFLOW_ENV=local
`,
  );

  console.log(`created apps/${name} (port ${port})`);
}

const SERVICES = [
  ['api-gateway', 3000, 'Edge routing, authentication and rate limiting for LedgerFlow APIs.'],
  ['identity-service', 3001, 'Users, roles, permissions, tokens and revocation.'],
  ['merchant-service', 3002, 'Merchant profiles, status and settlement configuration.'],
  ['payment-service', 3003, 'Payment lifecycle, attempts, provider references and idempotency.'],
  ['ledger-service', 3004, 'Double-entry accounts, journals and immutable ledger entries.'],
  ['settlement-service', 3005, 'Settlement batches, calculation, snapshots and payout lifecycle.'],
  ['reconciliation-service', 3006, 'Statement import, matching, mismatch cases and remediation.'],
  ['risk-service', 3007, 'Deterministic risk rules, scoring and decisions.'],
  ['notification-service', 3008, 'Notification requests, simulated delivery and retries.'],
  ['acquirer-simulator', 3009, 'Deterministic external acquirer simulation with failure modes.'],
];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , name, port, description] = process.argv;

  if (name) {
    scaffoldService({ name, port: Number(port ?? 3000), description: description ?? name });
  } else {
    for (const [serviceName, servicePort, serviceDescription] of SERVICES) {
      scaffoldService({ name: serviceName, port: servicePort, description: serviceDescription });
    }
  }
}
