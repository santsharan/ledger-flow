import { BusinessConflictError, ErrorCode } from '@ledgerflow/errors';

export const SETTLEMENT_STATUSES = [
  'CREATED',
  'CALCULATING',
  'CALCULATED',
  'APPROVED',
  'SUBMITTED',
  'SETTLEMENT_UNKNOWN',
  'CONFIRMED',
  'FAILED',
  'REVERSED',
] as const;

export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

const TRANSITIONS: Readonly<Record<SettlementStatus, readonly SettlementStatus[]>> = {
  CREATED: ['CALCULATING'],
  CALCULATING: ['CALCULATED', 'FAILED'],
  CALCULATED: ['APPROVED', 'FAILED'],
  APPROVED: ['SUBMITTED'],
  SUBMITTED: ['CONFIRMED', 'SETTLEMENT_UNKNOWN', 'FAILED'],
  SETTLEMENT_UNKNOWN: ['CONFIRMED', 'FAILED'],
  CONFIRMED: ['REVERSED'],
  FAILED: [],
  REVERSED: [],
};

export function canTransitionSettlement(from: SettlementStatus, to: SettlementStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertSettlementTransition(from: SettlementStatus, to: SettlementStatus): void {
  if (!canTransitionSettlement(from, to)) {
    const code =
      from === 'CONFIRMED' && to === 'CONFIRMED'
        ? ErrorCode.SETTLEMENT_ALREADY_CONFIRMED
        : ErrorCode.INVALID_SETTLEMENT_STATE_TRANSITION;
    throw new BusinessConflictError(code, `Settlement cannot move from ${from} to ${to}.`, {
      from,
      to,
      allowed: TRANSITIONS[from],
    });
  }
}

export function assertWithinPayable(netMinor: bigint, availablePayableMinor: bigint): void {
  if (netMinor > availablePayableMinor) {
    throw new BusinessConflictError(
      ErrorCode.SETTLEMENT_EXCEEDS_PAYABLE,
      'Settlement net exceeds the merchant payable balance.',
      { netMinor: netMinor.toString(), availablePayableMinor: availablePayableMinor.toString() },
    );
  }
}
