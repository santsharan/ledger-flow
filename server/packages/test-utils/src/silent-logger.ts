import { createLogger, type Logger } from '@ledgerflow/logger';

/** A logger that stays quiet unless a test explicitly raises the level. */
export function silentLogger(level: 'fatal' | 'debug' = 'fatal'): Logger {
  return createLogger({ service: 'test', environment: 'test', level });
}
