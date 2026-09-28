import { z } from 'zod';
import { EventRegistry } from './envelope';

const minorAmount = z.string().regex(/^[1-9]\d*$/);
const currency = z.string().length(3);

export const PaymentAuthorizedV1 = z.object({
  paymentId: z.string().uuid(),
  merchantId: z.string().uuid(),
  amountMinor: minorAmount,
  currency,
  attemptId: z.string().uuid(),
  providerReference: z.string().min(1),
});

export const PaymentCapturedV1 = z.object({
  paymentId: z.string().uuid(),
  merchantId: z.string().uuid(),
  amountMinor: minorAmount,
  currency,
  attemptId: z.string().uuid(),
});

export const PaymentRefundedV1 = z.object({
  paymentId: z.string().uuid(),
  merchantId: z.string().uuid(),
  amountMinor: minorAmount,
  currency,
  attemptId: z.string().uuid(),
  refundedMinor: minorAmount,
  fullyRefunded: z.boolean(),
});

export const LedgerPostedV1 = z.object({
  journalId: z.string().uuid(),
  referenceType: z.string().min(1),
  referenceId: z.string().min(1),
  currency,
  debitMinor: minorAmount,
  creditMinor: minorAmount,
});

export const EventType = {
  PaymentAuthorized: 'PaymentAuthorized',
  PaymentCaptured: 'PaymentCaptured',
  PaymentRefunded: 'PaymentRefunded',
  LedgerPosted: 'LedgerPosted',
} as const;

/** The versions this codebase produces and consumes. Adding a version is explicit. */
export function ledgerFlowRegistry(): EventRegistry {
  return new EventRegistry()
    .register({ eventType: EventType.PaymentAuthorized, version: 1, schema: PaymentAuthorizedV1 })
    .register({ eventType: EventType.PaymentCaptured, version: 1, schema: PaymentCapturedV1 })
    .register({ eventType: EventType.PaymentRefunded, version: 1, schema: PaymentRefundedV1 })
    .register({ eventType: EventType.LedgerPosted, version: 1, schema: LedgerPostedV1 });
}
