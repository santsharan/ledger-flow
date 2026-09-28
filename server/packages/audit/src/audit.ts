import { randomUUID } from 'node:crypto';
import { type Executor } from '@ledgerflow/database';

export type AuditActorType = 'USER' | 'SERVICE' | 'SYSTEM';

export interface AuditEntry {
  readonly actorType: AuditActorType;
  readonly actorId: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly beforeState?: Record<string, unknown> | null;
  readonly afterState?: Record<string, unknown> | null;
  readonly reason?: string | null;
  readonly ipAddress?: string | null;
  readonly requestId?: string | null;
  readonly correlationId?: string | null;
  readonly traceId?: string | null;
}

/**
 * Fields that must never reach an audit record (specification §31).
 *
 * The audit trail records *what changed and why*, not the material an attacker would want.
 * Redaction is by field name against the state objects, applied recursively.
 */
const FORBIDDEN_FIELDS = new Set([
  'password',
  'passwordhash',
  'password_hash',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'tokenhash',
  'token_hash',
  'apikey',
  'api_key',
  'secret',
  'clientsecret',
  'client_secret',
  'privatekey',
  'private_key',
  'cardnumber',
  'card_number',
  'pan',
  'cvv',
  'cvc',
]);

export const REDACTED = '[REDACTED]';

export function redactState(
  state: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (state === null || state === undefined) return null;
  return redactObject(state);
}

function redactObject(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_FIELDS.has(key.toLowerCase())) {
      result[key] = REDACTED;
      continue;
    }
    result[key] = redactValue(item);
  }

  return result;
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value !== null && typeof value === 'object') {
    return redactObject(value as Record<string, unknown>);
  }
  return value;
}

/**
 * Appends an audit record.
 *
 * Takes an `Executor` so the caller passes the *same transaction* as the business change:
 * an audited action cannot exist without its audit record (ADR-015).
 */
export async function writeAudit(executor: Executor, entry: AuditEntry): Promise<string> {
  const auditId = randomUUID();

  await executor.query(
    `INSERT INTO audit_events (
       audit_id, actor_type, actor_id, action, resource_type, resource_id,
       before_state, after_state, reason, ip_address, request_id, correlation_id, trace_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      auditId,
      entry.actorType,
      entry.actorId,
      entry.action,
      entry.resourceType,
      entry.resourceId,
      jsonOrNull(redactState(entry.beforeState)),
      jsonOrNull(redactState(entry.afterState)),
      entry.reason ?? null,
      entry.ipAddress ?? null,
      entry.requestId ?? null,
      entry.correlationId ?? null,
      entry.traceId ?? null,
    ],
  );

  return auditId;
}

function jsonOrNull(value: Record<string, unknown> | null): string | null {
  return value === null ? null : JSON.stringify(value);
}

/**
 * The audit table, identical in every service database.
 *
 * Audit lives beside the business data so it shares the transaction; the trigger and the absence
 * of UPDATE/DELETE grants make it append-only.
 */
export const AUDIT_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS audit_events (
  audit_id       uuid PRIMARY KEY,
  actor_type     text NOT NULL CHECK (actor_type IN ('USER', 'SERVICE', 'SYSTEM')),
  actor_id       text NOT NULL,
  action         text NOT NULL,
  resource_type  text NOT NULL,
  resource_id    text NOT NULL,
  before_state   jsonb,
  after_state    jsonb,
  reason         text,
  ip_address     inet,
  request_id     text,
  correlation_id text,
  trace_id       text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_events_resource_idx
  ON audit_events (resource_type, resource_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_actor_idx
  ON audit_events (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_correlation_idx
  ON audit_events (correlation_id);

CREATE OR REPLACE FUNCTION audit_events_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only (ADR-015)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_events_no_update ON audit_events;
CREATE TRIGGER audit_events_no_update
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_reject_mutation();
`;
