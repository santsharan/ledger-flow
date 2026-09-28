import {
  EventType,
  createEnvelope,
  ledgerFlowRegistry,
  type EventEnvelope,
} from '@ledgerflow/events';
import { Database } from '@ledgerflow/database';
import { silentLogger, startPostgres, type PostgresFixture } from '@ledgerflow/test-utils';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryBroker } from './broker';
import { InboxConsumer } from './inbox';
import { OutboxPublisher, appendOutbox } from './outbox';
import { MESSAGING_SCHEMA_SQL } from './schema';

let fixture: PostgresFixture;
let database: Database;
let broker: InMemoryBroker;

const paymentId = '11111111-1111-4111-8111-111111111111';
const merchantId = '22222222-2222-4222-8222-222222222222';
const attemptId = '33333333-3333-4333-8333-333333333333';

function capturedEnvelope(): EventEnvelope {
  return createEnvelope({
    eventType: EventType.PaymentCaptured,
    eventVersion: 1,
    producer: 'payment-service',
    aggregateType: 'payment',
    aggregateId: paymentId,
    payload: {
      paymentId,
      merchantId,
      amountMinor: '10000',
      currency: 'INR',
      attemptId,
    },
  });
}

beforeAll(async () => {
  fixture = await startPostgres({ database: 'ledgerflow_messaging_test' });
  database = new Database({ connectionString: fixture.connectionString }, silentLogger());
  await database.query(MESSAGING_SCHEMA_SQL);
  await database.query(`
    CREATE TABLE effects (
      event_id uuid PRIMARY KEY,
      amount_minor bigint NOT NULL
    )
  `);
}, 180_000);

afterAll(async () => {
  await database.close();
  await fixture.stop();
});

beforeEach(async () => {
  broker = new InMemoryBroker();
  await database.query('TRUNCATE outbox_events, inbox_events, dead_letters, effects');
});

async function commitBusinessAndOutbox(event = capturedEnvelope()): Promise<void> {
  await database.withTransaction(async (tx) => {
    await tx.query('INSERT INTO effects (event_id, amount_minor) VALUES ($1, 0)', [event.eventId]);
    await appendOutbox(tx, event);
  });
}

describe('outbox publisher crashes', () => {
  it('leaves the outbox pending when the broker is unavailable before accept', async () => {
    const event = capturedEnvelope();
    await commitBusinessAndOutbox(event);

    const down = {
      publish(): Promise<void> {
        return Promise.reject(new Error('broker unavailable'));
      },
    };
    const publisher = new OutboxPublisher(database, down, silentLogger(), { backoffMs: () => 0 });
    const attempt = await publisher.publishPending();

    expect(attempt.published).toBe(0);
    expect(attempt.retrying).toBe(1);
    const pending = await database.query<{ status: string }>(
      `SELECT status FROM outbox_events WHERE event_id = $1`,
      [event.eventId],
    );
    expect(pending.rows[0]?.status).toBe('PENDING');

    const recovered = new OutboxPublisher(database, broker, silentLogger(), { backoffMs: () => 0 });
    expect((await recovered.publishPending()).published).toBe(1);
    expect(broker.sent).toHaveLength(1);
  });

  it('keeps the outbox row when the publisher crashes after the broker accepts the message', async () => {
    const event = capturedEnvelope();
    await commitBusinessAndOutbox(event);
    broker.failAfterAccept = true;

    const publisher = new OutboxPublisher(database, broker, silentLogger(), { backoffMs: () => 0 });
    const first = await publisher.publishPending();

    expect(first.published).toBe(0);
    expect(first.retrying).toBe(1);
    expect(broker.sent).toHaveLength(1);

    const row = await database.query<{ status: string }>(
      'SELECT status FROM outbox_events WHERE event_id = $1',
      [event.eventId],
    );
    expect(row.rows[0]?.status).toBe('PENDING');
    const effect = await database.query('SELECT amount_minor FROM effects');
    expect(effect.rowCount).toBe(1);
  });

  it('publishes the same event again after the publisher restarts', async () => {
    const event = capturedEnvelope();
    await commitBusinessAndOutbox(event);

    const crashing = new OutboxPublisher(database, broker, silentLogger(), {
      backoffMs: () => 0,
      afterBrokerAck: () =>
        Promise.reject(new Error('process killed before published_at was written')),
    });
    await crashing.publishPending();

    const restarted = new OutboxPublisher(database, broker, silentLogger(), { backoffMs: () => 0 });
    const second = await restarted.publishPending();

    expect(second.published).toBe(1);
    expect(broker.sent.map((item) => item.eventId)).toEqual([event.eventId, event.eventId]);

    const row = await database.query<{ status: string }>('SELECT status FROM outbox_events');
    expect(row.rows[0]?.status).toBe('PUBLISHED');
  });

  it('recovers a claim left behind by a publisher that died before it could retry', async () => {
    const event = capturedEnvelope();
    await commitBusinessAndOutbox(event);
    await database.query(
      `UPDATE outbox_events SET status = 'PUBLISHING', claimed_at = now() - interval '1 minute', attempt_count = 1`,
    );

    const publisher = new OutboxPublisher(database, broker, silentLogger());
    expect(await publisher.recoverStuck(0)).toBe(1);
    expect((await publisher.publishPending()).published).toBe(1);
  });
});

describe('inbox consumers', () => {
  function consumer(): InboxConsumer {
    return new InboxConsumer(database, 'ledger-service', ledgerFlowRegistry());
  }

  it('applies a duplicate delivery only once', async () => {
    const event = capturedEnvelope();
    await database.query('INSERT INTO effects (event_id, amount_minor) VALUES ($1, 0)', [
      event.eventId,
    ]);

    const first = await consumer().consume(event, async (tx, parsed) => {
      await tx.query('UPDATE effects SET amount_minor = $2 WHERE event_id = $1', [
        parsed.eventId,
        (parsed.payload as { amountMinor: string }).amountMinor,
      ]);
    });
    const second = await consumer().consume(event, () =>
      Promise.reject(new Error('duplicate must not run business logic')),
    );

    expect(first).toBe('PROCESSED');
    expect(second).toBe('DUPLICATE');
    const effect = await database.query<{ amount_minor: string }>(
      'SELECT amount_minor FROM effects',
    );
    expect(effect.rows[0]?.amount_minor).toBe('10000');
  });

  it('rolls the inbox back when the consumer crashes before completion', async () => {
    const event = capturedEnvelope();
    await database.query('INSERT INTO effects (event_id, amount_minor) VALUES ($1, 0)', [
      event.eventId,
    ]);

    await expect(
      consumer().consume(event, async (tx) => {
        await tx.query('UPDATE effects SET amount_minor = 10000 WHERE event_id = $1', [
          event.eventId,
        ]);
        throw new Error('consumer crashed before commit');
      }),
    ).rejects.toThrow('consumer crashed before commit');

    const inbox = await database.query('SELECT event_id FROM inbox_events');
    expect(inbox.rowCount).toBe(0);
    const effect = await database.query<{ amount_minor: string }>(
      'SELECT amount_minor FROM effects',
    );
    expect(effect.rows[0]?.amount_minor).toBe('0');

    const retried = await consumer().consume(event, async (tx, parsed) => {
      await tx.query('UPDATE effects SET amount_minor = $2 WHERE event_id = $1', [
        parsed.eventId,
        (parsed.payload as { amountMinor: string }).amountMinor,
      ]);
    });
    expect(retried).toBe('PROCESSED');
    const after = await database.query<{ amount_minor: string }>(
      'SELECT amount_minor FROM effects',
    );
    expect(after.rows[0]?.amount_minor).toBe('10000');
  });

  it('ignores a redelivery after the business transaction has committed', async () => {
    const event = capturedEnvelope();
    await database.query('INSERT INTO effects (event_id, amount_minor) VALUES ($1, 0)', [
      event.eventId,
    ]);
    let runs = 0;

    await consumer().consume(event, async (tx, parsed) => {
      runs += 1;
      await tx.query('UPDATE effects SET amount_minor = $2 WHERE event_id = $1', [
        parsed.eventId,
        (parsed.payload as { amountMinor: string }).amountMinor,
      ]);
    });
    // The offset was not acknowledged. The broker delivers the same message again.
    const redelivery = await consumer().consume(event, () => {
      runs += 1;
      return Promise.resolve();
    });

    expect(redelivery).toBe('DUPLICATE');
    expect(runs).toBe(1);
  });

  it('dead-letters a malformed event without a business effect', async () => {
    let runs = 0;
    const result = await consumer().consume({ eventType: 'PaymentCaptured' }, () => {
      runs += 1;
      return Promise.resolve();
    });

    expect(result).toBe('REJECTED');
    expect(runs).toBe(0);
    const dead = await database.query<{ error_code: string }>(
      'SELECT error_code FROM dead_letters',
    );
    expect(dead.rows[0]?.error_code).toBe('MALFORMED_EVENT');
    const inbox = await database.query('SELECT event_id FROM inbox_events');
    expect(inbox.rowCount).toBe(0);
  });

  it('dead-letters an incompatible event version', async () => {
    const event = createEnvelope({
      eventType: EventType.PaymentCaptured,
      eventVersion: 2,
      producer: 'payment-service',
      aggregateType: 'payment',
      aggregateId: paymentId,
      payload: { paymentId },
    });

    const result = await consumer().consume(event, () =>
      Promise.reject(new Error('must not apply an unknown version')),
    );

    expect(result).toBe('REJECTED');
    const dead = await database.query<{ error_code: string }>(
      'SELECT error_code FROM dead_letters',
    );
    expect(dead.rows[0]?.error_code).toBe('UNSUPPORTED_EVENT_VERSION');
  });
});
