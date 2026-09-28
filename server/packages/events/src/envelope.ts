import { randomUUID } from 'node:crypto';
import { AppError, ErrorCode } from '@ledgerflow/errors';
import { z, type ZodType } from 'zod';

/**
 * Every event the platform publishes uses this envelope (specification §20).
 * `eventVersion` is part of the contract: consumers declare which versions they understand
 * and reject the rest instead of guessing.
 */
export const EventEnvelopeSchema = z.object({
  eventId: z.string().uuid(),
  eventType: z.string().min(1),
  eventVersion: z.number().int().positive(),
  occurredAt: z.string().datetime(),
  producer: z.string().min(1),
  aggregateType: z.string().min(1),
  aggregateId: z.string().min(1),
  correlationId: z.string().min(1),
  causationId: z.string().min(1).optional(),
  traceId: z.string().min(1).optional(),
  tenantId: z.string().min(1).optional(),
  payload: z.unknown(),
});

export interface EventEnvelope<TPayload = unknown> {
  readonly eventId: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly occurredAt: string;
  readonly producer: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly traceId?: string;
  readonly tenantId?: string;
  readonly payload: TPayload;
}

export interface CreateEnvelopeInput<TPayload> {
  readonly eventType: string;
  readonly eventVersion: number;
  readonly producer: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: TPayload;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly traceId?: string;
  readonly tenantId?: string;
}

export function createEnvelope<TPayload>(
  input: CreateEnvelopeInput<TPayload>,
): EventEnvelope<TPayload> {
  return {
    eventId: randomUUID(),
    eventType: input.eventType,
    eventVersion: input.eventVersion,
    occurredAt: new Date().toISOString(),
    producer: input.producer,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    correlationId: input.correlationId ?? `cor_${randomUUID()}`,
    ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
    ...(input.traceId === undefined ? {} : { traceId: input.traceId }),
    ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
    payload: input.payload,
  };
}

export class MalformedEventError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super({
      code: ErrorCode.MALFORMED_EVENT,
      message,
      httpStatus: 400,
      category: 'PERMANENT',
      ...(details === undefined ? {} : { details }),
    });
  }
}

export class UnsupportedEventVersionError extends AppError {
  constructor(eventType: string, eventVersion: number, supported: readonly number[]) {
    super({
      code: ErrorCode.UNSUPPORTED_EVENT_VERSION,
      message: `Event ${eventType} version ${eventVersion} is not supported.`,
      httpStatus: 400,
      category: 'PERMANENT',
      details: { eventType, eventVersion, supported },
    });
  }
}

export interface EventRegistration {
  readonly eventType: string;
  readonly version: number;
  readonly schema: ZodType;
}

/**
 * Consumers register the versions they can apply. An unknown version is rejected before any
 * business write, so an old consumer never misreads a new payload.
 */
export class EventRegistry {
  private readonly schemas = new Map<string, ZodType>();

  register(registration: EventRegistration): this {
    this.schemas.set(key(registration.eventType, registration.version), registration.schema);
    return this;
  }

  supportedVersions(eventType: string): number[] {
    const versions: number[] = [];
    for (const registered of this.schemas.keys()) {
      if (registered.startsWith(`${eventType}@`)) {
        versions.push(Number(registered.split('@')[1]));
      }
    }
    return versions.sort((left, right) => left - right);
  }

  parse(input: unknown): EventEnvelope {
    const envelope = EventEnvelopeSchema.safeParse(input);
    if (!envelope.success) {
      throw new MalformedEventError('Event envelope is malformed.', {
        issues: envelope.error.issues.map((issue) => issue.message),
      });
    }

    const schema = this.schemas.get(key(envelope.data.eventType, envelope.data.eventVersion));
    if (schema === undefined) {
      throw new UnsupportedEventVersionError(
        envelope.data.eventType,
        envelope.data.eventVersion,
        this.supportedVersions(envelope.data.eventType),
      );
    }

    const payload = schema.safeParse(envelope.data.payload);
    if (!payload.success) {
      throw new MalformedEventError(`Payload for ${envelope.data.eventType} is malformed.`, {
        issues: payload.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      });
    }

    const parsed = envelope.data;
    return {
      eventId: parsed.eventId,
      eventType: parsed.eventType,
      eventVersion: parsed.eventVersion,
      occurredAt: parsed.occurredAt,
      producer: parsed.producer,
      aggregateType: parsed.aggregateType,
      aggregateId: parsed.aggregateId,
      correlationId: parsed.correlationId,
      ...(parsed.causationId === undefined ? {} : { causationId: parsed.causationId }),
      ...(parsed.traceId === undefined ? {} : { traceId: parsed.traceId }),
      ...(parsed.tenantId === undefined ? {} : { tenantId: parsed.tenantId }),
      payload: payload.data,
    };
  }
}

function key(eventType: string, version: number): string {
  return `${eventType}@${version}`;
}
