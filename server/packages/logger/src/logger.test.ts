import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { REDACTED_PATHS, REDACTED_PLACEHOLDER } from './redaction';

interface CapturedLog {
  readonly lines: Record<string, unknown>[];
  readonly logger: pino.Logger;
}

function captureLogger(): CapturedLog {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback): void {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      callback();
    },
  });

  const logger = pino(
    {
      base: { service: 'test-service', environment: 'test' },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: [...REDACTED_PATHS], censor: REDACTED_PLACEHOLDER },
      formatters: { level: (label) => ({ level: label }) },
    },
    stream,
  );

  return { lines, logger };
}

describe('logger redaction', () => {
  it('redacts authentication material', () => {
    const { lines, logger } = captureLogger();

    logger.info(
      {
        event: 'payment.authorization.started',
        accessToken: 'eyJhbGciOi.real.token',
        password: 'hunter2',
        apiKey: 'sk_live_123',
      },
      'authorizing',
    );

    const line = lines[0]!;
    expect(line.accessToken).toBe(REDACTED_PLACEHOLDER);
    expect(line.password).toBe(REDACTED_PLACEHOLDER);
    expect(line.apiKey).toBe(REDACTED_PLACEHOLDER);
    expect(JSON.stringify(line)).not.toContain('hunter2');
  });

  it('redacts nested payment secrets and customer PII', () => {
    const { lines, logger } = captureLogger();

    logger.info({
      event: 'payment.created',
      customer: { email: 'someone@example.com', phone: '+911234567890' },
      instrument: { cardNumber: '4111111111111111', cvv: '123' },
    });

    const serialized = JSON.stringify(lines[0]);
    expect(serialized).not.toContain('someone@example.com');
    expect(serialized).not.toContain('4111111111111111');
    expect(serialized).not.toContain('123456');
  });

  it('keeps business identifiers intact', () => {
    const { lines, logger } = captureLogger();

    logger.info({
      event: 'ledger.journal.posted',
      paymentId: 'pay_123',
      merchantId: 'mer_456',
      journalId: 'jrn_789',
      durationMs: 12,
    });

    expect(lines[0]).toMatchObject({
      service: 'test-service',
      environment: 'test',
      level: 'info',
      event: 'ledger.journal.posted',
      paymentId: 'pay_123',
      merchantId: 'mer_456',
      journalId: 'jrn_789',
      durationMs: 12,
    });
  });
});
