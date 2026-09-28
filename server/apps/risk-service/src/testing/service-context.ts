import { BaseConfigSchema, loadConfig } from '@ledgerflow/config';
import { createLogger } from '@ledgerflow/logger';
import { type ServiceContext } from '@ledgerflow/service-core';

/** Builds the same context `bootstrapService` builds, for use in tests. */
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
