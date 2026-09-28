import { BusinessConflictError, ErrorCode } from '@ledgerflow/errors';

/**
 * Payment status is a closed set of transitions (ADR-004).
 * Anything not listed here is refused, including every self-transition.
 */
export const PAYMENT_STATUSES = [
  'CREATED',
  'RISK_DECLINED',
  'AUTHORIZATION_PENDING',
  'AUTHORIZATION_UNKNOWN',
  'AUTHORIZED',
  'AUTHORIZATION_FAILED',
  'CAPTURE_PENDING',
  'CAPTURE_UNKNOWN',
  'CAPTURED',
  'CAPTURE_FAILED',
  'REFUND_PENDING',
  'REFUND_UNKNOWN',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'CANCEL_PENDING',
  'CANCELLED',
  'EXPIRED',
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

const TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  CREATED: ['RISK_DECLINED', 'AUTHORIZATION_PENDING'],
  RISK_DECLINED: [],
  AUTHORIZATION_PENDING: ['AUTHORIZED', 'AUTHORIZATION_FAILED', 'AUTHORIZATION_UNKNOWN'],
  AUTHORIZATION_UNKNOWN: ['AUTHORIZED', 'AUTHORIZATION_FAILED'],
  AUTHORIZED: ['CAPTURE_PENDING', 'CANCEL_PENDING', 'EXPIRED'],
  AUTHORIZATION_FAILED: [],
  CAPTURE_PENDING: ['CAPTURED', 'CAPTURE_FAILED', 'CAPTURE_UNKNOWN'],
  CAPTURE_UNKNOWN: ['CAPTURED', 'CAPTURE_FAILED'],
  CAPTURE_FAILED: ['CAPTURE_PENDING', 'AUTHORIZED'],
  CAPTURED: ['REFUND_PENDING'],
  REFUND_PENDING: ['PARTIALLY_REFUNDED', 'REFUNDED', 'REFUND_UNKNOWN', 'CAPTURED'],
  REFUND_UNKNOWN: ['PARTIALLY_REFUNDED', 'REFUNDED', 'CAPTURED'],
  PARTIALLY_REFUNDED: ['REFUND_PENDING'],
  REFUNDED: [],
  CANCEL_PENDING: ['CANCELLED', 'AUTHORIZED'],
  CANCELLED: [],
  EXPIRED: [],
};

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!canTransition(from, to)) {
    const code =
      (from === 'CAPTURED' || from === 'PARTIALLY_REFUNDED' || from === 'REFUNDED') &&
      to === 'CAPTURE_PENDING'
        ? ErrorCode.PAYMENT_ALREADY_CAPTURED
        : ErrorCode.INVALID_PAYMENT_STATE_TRANSITION;

    throw new BusinessConflictError(
      code,
      `Payment cannot move from ${from} to ${to}.`,
      { from, to, allowed: TRANSITIONS[from] },
    );
  }
}

export function assertCaptureAmount(authorizedMinor: bigint, requestedMinor: bigint): void {
  if (requestedMinor <= 0n) {
    throw new BusinessConflictError(ErrorCode.INVALID_MONEY_AMOUNT, 'Capture amount must be positive.');
  }
  if (requestedMinor > authorizedMinor) {
    throw new BusinessConflictError(
      ErrorCode.CAPTURE_EXCEEDS_AUTHORIZED,
      'Capture exceeds the authorized amount.',
      { authorizedMinor: authorizedMinor.toString(), requestedMinor: requestedMinor.toString() },
    );
  }
}

export function assertRefundAmount(capturedMinor: bigint, alreadyRefundedMinor: bigint, requestedMinor: bigint): void {
  if (requestedMinor <= 0n) {
    throw new BusinessConflictError(ErrorCode.INVALID_MONEY_AMOUNT, 'Refund amount must be positive.');
  }
  const remaining = capturedMinor - alreadyRefundedMinor;
  if (requestedMinor > remaining) {
    throw new BusinessConflictError(
      ErrorCode.REFUND_EXCEEDS_CAPTURED,
      'Refund exceeds the captured amount.',
      {
        capturedMinor: capturedMinor.toString(),
        refundedMinor: alreadyRefundedMinor.toString(),
        requestedMinor: requestedMinor.toString(),
      },
    );
  }
}

/** Status after a successful refund of `requestedMinor`. */
export function statusAfterRefund(
  capturedMinor: bigint,
  alreadyRefundedMinor: bigint,
  requestedMinor: bigint,
): 'PARTIALLY_REFUNDED' | 'REFUNDED' {
  return alreadyRefundedMinor + requestedMinor === capturedMinor ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
}

export const UNKNOWN_STATUSES: readonly PaymentStatus[] = [
  'AUTHORIZATION_UNKNOWN',
  'AUTHORIZATION_PENDING',
  'CAPTURE_UNKNOWN',
  'CAPTURE_PENDING',
  'REFUND_UNKNOWN',
  'REFUND_PENDING',
];

export function isResolvable(status: PaymentStatus): boolean {
  return UNKNOWN_STATUSES.includes(status);
}
