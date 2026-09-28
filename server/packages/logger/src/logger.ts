import pino, { type Logger, type LoggerOptions } from 'pino';
import { REDACTED_PATHS, REDACTED_PLACEHOLDER } from './redaction';

export type { Logger } from 'pino';

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

export interface LoggerConfig {
  readonly service: string;
  readonly environment: string;
  readonly level: LogLevel;
  /** Human-readable output for local development; JSON everywhere else. */
  readonly pretty?: boolean;
}

/**
 * Structured fields that identify a business operation (specification §49).
 * Correlation and trace identifiers are attached per request by the HTTP layer.
 */
export interface LogContext {
  readonly event?: string;
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly traceId?: string;
  readonly durationMs?: number;
  readonly paymentId?: string;
  readonly merchantId?: string;
  readonly settlementId?: string;
  readonly journalId?: string;
  readonly reconciliationCaseId?: string;
  readonly errorCode?: string;
}

export function createLogger(config: LoggerConfig): Logger {
  const options: LoggerOptions = {
    level: config.level,
    base: {
      service: config.service,
      environment: config.environment,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [...REDACTED_PATHS],
      censor: REDACTED_PLACEHOLDER,
    },
    formatters: {
      level: (label) => ({ level: label }),
    },
  };

  if (config.pretty === true) {
    return pino({
      ...options,
      transport: {
        target: 'pino/file',
        options: { destination: 1 },
      },
    });
  }

  return pino(options);
}
