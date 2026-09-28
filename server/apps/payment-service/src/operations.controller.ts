import { Controller, Get, Query } from '@nestjs/common';
import { Permission, RequirePermissions } from '@ledgerflow/auth';
import { Database } from '@ledgerflow/database';
import { ValidationError } from '@ledgerflow/errors';

@Controller()
export class OperationsController {
  constructor(private readonly database: Database) {}

  @Get('audit/events')
  @RequirePermissions(Permission.PAYMENTS_READ)
  async audit(
    @Query('limit') limit?: string,
    @Query('resourceId') resourceId?: string,
  ): Promise<{ events: AuditEventView[] }> {
    const parsedLimit = parseLimit(limit);
    const result = await this.database.query<AuditRow>(
      `SELECT audit_id, actor_type, actor_id, action, resource_type, resource_id, reason,
              request_id, correlation_id, created_at, after_state
       FROM audit_events
       WHERE ($1::text IS NULL OR resource_id = $1)
       ORDER BY created_at DESC
       LIMIT $2`,
      [resourceId === undefined || resourceId === '' ? null : resourceId, parsedLimit],
    );
    return {
      events: result.rows.map((row) => ({
        id: row.audit_id,
        actorType: row.actor_type,
        actorId: row.actor_id,
        action: row.action,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        reason: row.reason,
        requestId: row.request_id,
        correlationId: row.correlation_id,
        createdAt: row.created_at.toISOString(),
        afterState: row.after_state,
      })),
    };
  }

  @Get('operations/outbox')
  @RequirePermissions(Permission.ADMIN_OPERATIONS)
  async outbox(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ): Promise<{ events: OutboxEventView[] }> {
    if (
      status !== undefined &&
      status !== '' &&
      !['PENDING', 'PUBLISHING', 'PUBLISHED', 'FAILED'].includes(status)
    ) {
      throw new ValidationError('status is not an outbox status.');
    }
    const result = await this.database.query<OutboxRow>(
      `SELECT id, event_id, aggregate_type, aggregate_id, event_type, event_version, status,
              attempt_count, created_at, published_at
       FROM outbox_events
       WHERE ($1::text IS NULL OR status = $1)
       ORDER BY created_at DESC
       LIMIT $2`,
      [status === undefined || status === '' ? null : status, parseLimit(limit)],
    );
    return {
      events: result.rows.map((row) => ({
        id: row.id,
        eventId: row.event_id,
        aggregateType: row.aggregate_type,
        aggregateId: row.aggregate_id,
        eventType: row.event_type,
        eventVersion: row.event_version,
        status: row.status,
        attemptCount: row.attempt_count,
        createdAt: row.created_at.toISOString(),
        publishedAt: row.published_at === null ? null : row.published_at.toISOString(),
      })),
    };
  }

  @Get('operations/dead-letters')
  @RequirePermissions(Permission.ADMIN_OPERATIONS)
  async deadLetters(
    @Query('limit') limit?: string,
  ): Promise<{ available: boolean; letters: DeadLetterView[] }> {
    const present = await this.database.query<{ name: string | null }>(
      `SELECT to_regclass('public.dead_letters')::text AS name`,
    );
    if (present.rows[0]?.name == null) return { available: false, letters: [] };
    const result = await this.database.query<DeadLetterRow>(
      `SELECT id, event_id, consumer, error_code, error_message, attempt_count, created_at
       FROM dead_letters
       ORDER BY created_at DESC
       LIMIT $1`,
      [parseLimit(limit)],
    );
    return {
      available: true,
      letters: result.rows.map((row) => ({
        id: row.id,
        eventId: row.event_id,
        consumer: row.consumer,
        errorCode: row.error_code,
        errorMessage: row.error_message,
        attemptCount: row.attempt_count,
        createdAt: row.created_at.toISOString(),
      })),
    };
  }
}

interface AuditEventView {
  readonly id: string;
  readonly actorType: string;
  readonly actorId: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly reason: string | null;
  readonly requestId: string | null;
  readonly correlationId: string | null;
  readonly createdAt: string;
  readonly afterState: unknown;
}

interface OutboxEventView {
  readonly id: string;
  readonly eventId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly status: string;
  readonly attemptCount: number;
  readonly createdAt: string;
  readonly publishedAt: string | null;
}

interface DeadLetterView {
  readonly id: string;
  readonly eventId: string | null;
  readonly consumer: string;
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly attemptCount: number;
  readonly createdAt: string;
}

interface AuditRow {
  audit_id: string;
  actor_type: string;
  actor_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  reason: string | null;
  request_id: string | null;
  correlation_id: string | null;
  created_at: Date;
  after_state: unknown;
}

interface OutboxRow {
  id: string;
  event_id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  event_version: number;
  status: string;
  attempt_count: number;
  created_at: Date;
  published_at: Date | null;
}

interface DeadLetterRow {
  id: string;
  event_id: string | null;
  consumer: string;
  error_code: string;
  error_message: string;
  attempt_count: number;
  created_at: Date;
}

function parseLimit(limit: string | undefined): number {
  if (limit === undefined || limit === '') return 50;
  const parsed = Number.parseInt(limit, 10);
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 200) {
    throw new ValidationError('limit must be between 1 and 200.');
  }
  return parsed;
}
