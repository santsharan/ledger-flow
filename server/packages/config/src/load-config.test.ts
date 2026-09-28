import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BaseConfigSchema, ConfigurationError, loadConfig } from './index';

describe('loadConfig', () => {
  it('applies defaults and coerces types', () => {
    const config = loadConfig(BaseConfigSchema, {
      SERVICE_NAME: 'payment-service',
      PORT: '3005',
    });

    expect(config.SERVICE_NAME).toBe('payment-service');
    expect(config.PORT).toBe(3005);
    expect(config.LEDGERFLOW_ENV).toBe('local');
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.LOG_PRETTY).toBe(false);
    expect(config.SHUTDOWN_TIMEOUT_MS).toBe(15_000);
  });

  it('rejects a missing required variable', () => {
    expect(() => loadConfig(BaseConfigSchema, {})).toThrow(ConfigurationError);
  });

  it('rejects an out-of-range port', () => {
    expect(() =>
      loadConfig(BaseConfigSchema, {
        SERVICE_NAME: 'x',
        PORT: '99999',
      }),
    ).toThrow(ConfigurationError);
  });

  it('reports variable names but never their values', () => {
    const schema = BaseConfigSchema.extend({ DATABASE_URL: z.string().url() });

    try {
      loadConfig(schema, {
        SERVICE_NAME: 'x',
        DATABASE_URL: 'sup3rsecret',
      });
      expect.unreachable('expected configuration to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      const configError = error as ConfigurationError;
      expect(configError.issues.join(' ')).toContain('DATABASE_URL');
      expect(configError.issues.join(' ')).not.toContain('sup3rsecret');
      expect(configError.message).not.toContain('sup3rsecret');
    }
  });
});
