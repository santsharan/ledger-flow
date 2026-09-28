import { randomUUID } from 'node:crypto';
import { type Database, type Executor } from '@ledgerflow/database';
import { type EventEnvelope } from '@ledgerflow/events';
import { type Logger } from '@ledgerflow/logger';
import { type EventPublisher } from './broker';

export interface OutboxPublisherOptions {
  readonly maxAttempts?: number;
  readonly batchSize?: number;
  readonly backoffMs?: (attempt: number) => number;
  /** Runs after the broker accepts the message and before the row is marked published. */
  readonly afterBrokerAck?: () => Promise<void>;
}

interface OutboxRow {
  id: string;
  event_id: string;
  attempt_count: number;
  payload: EventEnvelope;
}

/**
 * Publishes outbox rows that were inserted in the same transaction as the business change.
 * A crash after the broker ack and before `published_at` is written leaves the row claimable
 * again. The redelivery is safe because consumers dedupe on event id (ADR-006, ADR-007).
 */
export class OutboxPublisher {
  private readonly maxAttempts: number;
  private readonly batchSize: number;
  private readonly backoffMs: (attempt: number) => number;

  constructor(
    private readonly database: Database,
    private readonly broker: EventPublisher,
    private readonly logger: Logger,
    private readonly options: OutboxPublisherOptions = {},
  ) {
    this.maxAttempts = options.maxAttempts ?? 5;
    this.batchSize = options.batchSize ?? 50;
    this.backoffMs = options.backoffMs ?? ((attempt) => Math.min(30_000, 100 * 2 ** attempt));
  }

  async publishPending(): Promise<{ published: number; retrying: number; failed: number }> {
    const claimed = await this.claim();
    let published = 0;
    let retrying = 0;
    let failed = 0;

    for (const row of claimed) {
      try {
        await this.broker.publish(row.payload);
        if (this.options.afterBrokerAck !== undefined) {
          await this.options.afterBrokerAck();
        }
        await this.markPublished(row.id);
        published += 1;
      } catch (error) {
        const attempts = row.attempt_count;
        if (attempts >= this.maxAttempts) {
          await this.markFailed(row.id);
          failed += 1;
        } else {
          await this.markRetry(row.id, attempts);
          retrying += 1;
        }
        this.logger.warn(
          { event: 'outbox.publish.failed', eventId: row.event_id, attempt: attempts, err: error },
          'outbox publish failed',
        );
      }
    }

    return { published, retrying, failed };
  }

  /** Rows left in PUBLISHING by a dead publisher become pending again. */
  async recoverStuck(olderThanMs = 0): Promise<number> {
    const result = await this.database.query(
      `UPDATE outbox_events
       SET status = 'PENDING', claimed_at = NULL
       WHERE status = 'PUBLISHING'
         AND claimed_at < now() - ($1::text || ' milliseconds')::interval`,
      [String(olderThanMs)],
    );
    return result.rowCount;
  }

  private async claim(): Promise<OutboxRow[]> {
    const result = await this.database.query<OutboxRow>(
      `UPDATE outbox_events
       SET status = 'PUBLISHING',
           attempt_count = attempt_count + 1,
           claimed_at = now()
       WHERE id IN (
         SELECT id FROM outbox_events
         WHERE status = 'PENDING' AND next_attempt_at <= now()
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT $1
       )
       RETURNING id, event_id, attempt_count, payload`,
      [this.batchSize],
    );
    return result.rows.map((row) => ({
      ...row,
      payload:
        typeof row.payload === 'string' ? (JSON.parse(row.payload) as EventEnvelope) : row.payload,
    }));
  }

  private async markPublished(id: string): Promise<void> {
    await this.database.query(
      `UPDATE outbox_events SET status = 'PUBLISHED', published_at = now() WHERE id = $1`,
      [id],
    );
  }

  private async markRetry(id: string, attemptCount: number): Promise<void> {
    await this.database.query(
      `UPDATE outbox_events
       SET status = 'PENDING', claimed_at = NULL, next_attempt_at = now() + ($2::text || ' milliseconds')::interval
       WHERE id = $1`,
      [id, String(this.backoffMs(attemptCount))],
    );
  }

  private async markFailed(id: string): Promise<void> {
    await this.database.query(`UPDATE outbox_events SET status = 'FAILED' WHERE id = $1`, [id]);
  }
}

/** Inserts the event in the caller's transaction. Nothing is published here. */
export async function appendOutbox(executor: Executor, event: EventEnvelope): Promise<void> {
  await executor.query(
    `INSERT INTO outbox_events (
       id, event_id, aggregate_type, aggregate_id, event_type, event_version, payload
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      randomUUID(),
      event.eventId,
      event.aggregateType,
      event.aggregateId,
      event.eventType,
      event.eventVersion,
      JSON.stringify(event),
    ],
  );
}
