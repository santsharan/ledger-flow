import { type EventEnvelope } from '@ledgerflow/events';
import { Kafka, type Consumer, type Producer } from 'kafkajs';

/**
 * The only broker surface domain code is allowed to see.
 * Kafka, Service Bus and the in-memory test broker all implement this (ADR-008).
 */
export interface EventPublisher {
  publish(event: EventEnvelope): Promise<void>;
}

export interface EventConsumer {
  subscribe(groupId: string, handler: (event: unknown) => Promise<void>): Promise<void>;
  close(): Promise<void>;
}

/** Records publications and can fail after the broker has accepted the message. */
export class InMemoryBroker implements EventPublisher {
  readonly sent: EventEnvelope[] = [];
  failAfterAccept = false;

  publish(event: EventEnvelope): Promise<void> {
    this.sent.push(event);
    if (this.failAfterAccept) {
      return Promise.reject(
        new Error('broker accepted the message and the publisher then crashed'),
      );
    }
    return Promise.resolve();
  }
}

export interface KafkaBrokerConfig {
  readonly brokers: readonly string[];
  readonly clientId: string;
  readonly topic: string;
}

/**
 * Kafka adapter for local development and CI. Production workflow commands use Service Bus
 * behind the same EventPublisher interface; this adapter is the local implementation (ADR-008).
 * Delivery is at-least-once. Offsets are committed only after the handler resolves, and the
 * handler must commit its business transaction before resolving.
 */
export class KafkaBroker implements EventPublisher, EventConsumer {
  private readonly kafka: Kafka;
  private producer: Producer | undefined;
  private consumer: Consumer | undefined;

  constructor(private readonly config: KafkaBrokerConfig) {
    this.kafka = new Kafka({
      clientId: config.clientId,
      brokers: [...config.brokers],
    });
  }

  async publish(event: EventEnvelope): Promise<void> {
    this.producer ??= this.kafka.producer();
    await this.producer.connect();
    await this.producer.send({
      topic: this.config.topic,
      messages: [
        {
          key: event.aggregateId,
          value: JSON.stringify(event),
          headers: {
            eventType: event.eventType,
            eventVersion: String(event.eventVersion),
          },
        },
      ],
    });
  }

  async subscribe(groupId: string, handler: (event: unknown) => Promise<void>): Promise<void> {
    this.consumer = this.kafka.consumer({ groupId });
    await this.consumer.connect();
    await this.consumer.subscribe({ topic: this.config.topic, fromBeginning: true });
    await this.consumer.run({
      autoCommit: true,
      eachMessage: async ({ message }) => {
        if (message.value === null) return;
        const parsed: unknown = JSON.parse(message.value.toString());
        await handler(parsed);
      },
    });
  }

  async close(): Promise<void> {
    await this.consumer?.disconnect();
    await this.producer?.disconnect();
  }
}
