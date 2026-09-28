import { createHash, randomUUID } from 'node:crypto';
import { type Database, type Executor } from '@ledgerflow/database';
import { AppError } from '@ledgerflow/errors';
import {
  MalformedEventError,
  UnsupportedEventVersionError,
  type EventEnvelope,
  type EventRegistry,
} from '@ledgerflow/events';

export type ConsumeResult = 'PROCESSED' | 'DUPLICATE' | 'REJECTED';

/**
 * Applies an event at most once per consumer.
 * The inbox row and the business effect share one transaction: a crash before commit leaves
 * no inbox row, and a crash after commit makes the redelivery a duplicate (ADR-007).
 */
export class InboxConsumer {
  constructor(
    private readonly database: Database,
    private readonly consumerName: string,
    private readonly registry: EventRegistry,
  ) {}

  async consume(
    raw: unknown,
    work: (tx: Executor, event: EventEnvelope) => Promise<void>,
  ): Promise<ConsumeResult> {
    let event: EventEnvelope;
    try {
      event = this.registry.parse(raw);
    } catch (error) {
      await this.deadLetter(raw, error);
      return 'REJECTED';
    }

    const outcome = await this.database.withTransaction(async (tx) => {
      const inserted = await tx.query(
        `INSERT INTO inbox_events (event_id, consumer, payload_hash)
         VALUES ($1, $2, $3)
         ON CONFLICT (event_id, consumer) DO NOTHING`,
        [event.eventId, this.consumerName, payloadHash(event)],
      );
      if (inserted.rowCount === 0) {
        return 'DUPLICATE' as const;
      }
      await work(tx, event);
      return 'PROCESSED' as const;
    });

    return outcome;
  }

  private async deadLetter(raw: unknown, error: unknown): Promise<void> {
    const appError = AppError.isAppError(error) ? error : null;
    const code =
      error instanceof UnsupportedEventVersionError
        ? 'UNSUPPORTED_EVENT_VERSION'
        : error instanceof MalformedEventError
          ? 'MALFORMED_EVENT'
          : (appError?.code ?? 'MALFORMED_EVENT');

    const eventId = isRecord(raw) && typeof raw.eventId === 'string' ? raw.eventId : null;

    await this.database.query(
      `INSERT INTO dead_letters (id, event_id, consumer, error_code, error_message, payload)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        randomUUID(),
        eventId,
        this.consumerName,
        code,
        error instanceof Error ? error.message : 'Unreadable event',
        JSON.stringify(raw ?? null),
      ],
    );
  }
}

function payloadHash(event: EventEnvelope): string {
  return createHash('sha256').update(JSON.stringify(event.payload)).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
