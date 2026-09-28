import { BusinessConflictError } from '@ledgerflow/errors';
import { describe, expect, it } from 'vitest';
import {
  PAYMENT_STATUSES,
  assertCaptureAmount,
  assertRefundAmount,
  assertTransition,
  canTransition,
  statusAfterRefund,
  type PaymentStatus,
} from './payment-state';

const LEGAL: ReadonlyArray<readonly [PaymentStatus, PaymentStatus]> = [
  ['CREATED', 'RISK_DECLINED'],
  ['CREATED', 'AUTHORIZATION_PENDING'],
  ['AUTHORIZATION_PENDING', 'AUTHORIZED'],
  ['AUTHORIZATION_PENDING', 'AUTHORIZATION_FAILED'],
  ['AUTHORIZATION_PENDING', 'AUTHORIZATION_UNKNOWN'],
  ['AUTHORIZATION_UNKNOWN', 'AUTHORIZED'],
  ['AUTHORIZATION_UNKNOWN', 'AUTHORIZATION_FAILED'],
  ['AUTHORIZED', 'CAPTURE_PENDING'],
  ['AUTHORIZED', 'CANCEL_PENDING'],
  ['AUTHORIZED', 'EXPIRED'],
  ['CAPTURE_PENDING', 'CAPTURED'],
  ['CAPTURE_PENDING', 'CAPTURE_FAILED'],
  ['CAPTURE_PENDING', 'CAPTURE_UNKNOWN'],
  ['CAPTURE_UNKNOWN', 'CAPTURED'],
  ['CAPTURE_UNKNOWN', 'CAPTURE_FAILED'],
  ['CAPTURE_FAILED', 'CAPTURE_PENDING'],
  ['CAPTURE_FAILED', 'AUTHORIZED'],
  ['CAPTURED', 'REFUND_PENDING'],
  ['REFUND_PENDING', 'PARTIALLY_REFUNDED'],
  ['REFUND_PENDING', 'REFUNDED'],
  ['REFUND_PENDING', 'REFUND_UNKNOWN'],
  ['REFUND_PENDING', 'CAPTURED'],
  ['REFUND_UNKNOWN', 'PARTIALLY_REFUNDED'],
  ['REFUND_UNKNOWN', 'REFUNDED'],
  ['REFUND_UNKNOWN', 'CAPTURED'],
  ['PARTIALLY_REFUNDED', 'REFUND_PENDING'],
  ['CANCEL_PENDING', 'CANCELLED'],
  ['CANCEL_PENDING', 'AUTHORIZED'],
];

describe('payment state machine', () => {
  it('allows exactly the documented transitions', () => {
    const legal = new Set(LEGAL.map(([from, to]) => `${from}->${to}`));

    for (const from of PAYMENT_STATUSES) {
      for (const to of PAYMENT_STATUSES) {
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(legal.has(`${from}->${to}`));
      }
    }
  });

  it('refuses a terminal payment to move', () => {
    for (const status of ['REFUNDED', 'CANCELLED', 'EXPIRED', 'AUTHORIZATION_FAILED', 'RISK_DECLINED'] as const) {
      expect(() => assertTransition(status, 'AUTHORIZED')).toThrow(BusinessConflictError);
    }
  });

  it('reports an already-captured payment with a specific code', () => {
    try {
      assertTransition('CAPTURED', 'CAPTURE_PENDING');
      expect.unreachable('expected capture of a captured payment to fail');
    } catch (error) {
      expect((error as BusinessConflictError).code).toBe('PAYMENT_ALREADY_CAPTURED');
    }
  });

  it('refuses an unknown outcome to be retried as a new authorization', () => {
    expect(canTransition('AUTHORIZATION_UNKNOWN', 'AUTHORIZATION_PENDING')).toBe(false);
  });
});

describe('amount guards', () => {
  it('rejects a capture above the authorized amount', () => {
    expect(() => assertCaptureAmount(1000n, 1001n)).toThrow(BusinessConflictError);
    try {
      assertCaptureAmount(1000n, 1500n);
    } catch (error) {
      expect((error as BusinessConflictError).code).toBe('CAPTURE_EXCEEDS_AUTHORIZED');
    }
    expect(() => assertCaptureAmount(1000n, 1000n)).not.toThrow();
    expect(() => assertCaptureAmount(1000n, 1n)).not.toThrow();
  });

  it('rejects a refund above the remaining captured amount', () => {
    expect(() => assertRefundAmount(1000n, 400n, 601n)).toThrow(BusinessConflictError);
    expect(() => assertRefundAmount(1000n, 400n, 600n)).not.toThrow();
    expect(statusAfterRefund(1000n, 400n, 600n)).toBe('REFUNDED');
    expect(statusAfterRefund(1000n, 0n, 100n)).toBe('PARTIALLY_REFUNDED');
  });
});
