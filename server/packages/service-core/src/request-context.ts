import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * Correlation identifiers that must follow a request across API, command, payment, ledger,
 * event, settlement and reconciliation (specification §70).
 */
export interface RequestContext {
  readonly requestId: string;
  readonly correlationId: string;
  readonly causationId?: string;
  readonly traceId?: string;
  readonly actorId?: string;
  readonly actorType?: string;
  readonly merchantId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function requireRequestContext(): RequestContext {
  const context = storage.getStore();
  if (context === undefined) {
    throw new Error('No request context is active.');
  }
  return context;
}

export const REQUEST_ID_HEADER = 'x-request-id';
export const CORRELATION_ID_HEADER = 'x-correlation-id';

export function newRequestId(): string {
  return `req_${randomUUID()}`;
}

export function newCorrelationId(): string {
  return `cor_${randomUUID()}`;
}
