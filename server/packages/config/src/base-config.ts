import { z } from 'zod';

export const EnvironmentSchema = z.enum(['local', 'test', 'dev', 'demo', 'prod']);
export type Environment = z.infer<typeof EnvironmentSchema>;

export const LogLevelSchema = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']);

const booleanFromEnv = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

/**
 * Configuration every service shares. Service-specific schemas extend this one.
 *
 * Configuration is validated at startup and the process refuses to boot on a bad value:
 * a service that starts with a missing database URL only fails later, under load, in production.
 */
export const BaseConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LEDGERFLOW_ENV: EnvironmentSchema.default('local'),
  SERVICE_NAME: z.string().min(1),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: LogLevelSchema.default('info'),
  LOG_PRETTY: booleanFromEnv.default('false'),

  /** Requests larger than this are rejected at the HTTP layer (specification §35). */
  MAX_REQUEST_BODY_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(256 * 1024),
  /** Time allowed for in-flight work to finish after SIGTERM (failure-model.md §6). */
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),

  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  OTEL_ENABLED: booleanFromEnv.default('false'),
});

export type BaseConfig = z.infer<typeof BaseConfigSchema>;
