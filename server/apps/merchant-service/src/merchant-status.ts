import { BusinessConflictError, ErrorCode } from '@ledgerflow/errors';
import { type MerchantStatus } from '@ledgerflow/contracts';

/**
 * Merchant status is a state machine, not a mutable column.
 *
 * A closed merchant never reopens: reinstating a closed account is an onboarding decision with
 * its own compliance checks, not a status flip.
 */
const TRANSITIONS: Readonly<Record<MerchantStatus, readonly MerchantStatus[]>> = {
  MERCHANT_PENDING: ['MERCHANT_ACTIVE', 'MERCHANT_CLOSED'],
  MERCHANT_ACTIVE: ['MERCHANT_SUSPENDED', 'MERCHANT_CLOSED'],
  MERCHANT_SUSPENDED: ['MERCHANT_ACTIVE', 'MERCHANT_CLOSED'],
  MERCHANT_CLOSED: [],
};

export function canTransition(from: MerchantStatus, to: MerchantStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: MerchantStatus, to: MerchantStatus): void {
  if (!canTransition(from, to)) {
    throw new BusinessConflictError(
      ErrorCode.CONFLICT,
      `A merchant cannot move from ${from} to ${to}.`,
      { from, to, allowed: TRANSITIONS[from] },
    );
  }
}

/** Only an active merchant may transact; everything else is a deterministic refusal. */
export function assertCanTransact(status: MerchantStatus): void {
  if (status !== 'MERCHANT_ACTIVE') {
    throw new BusinessConflictError(
      ErrorCode.MERCHANT_NOT_ACTIVE,
      'The merchant is not active and cannot transact.',
      { status },
    );
  }
}
