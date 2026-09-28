import { createHash } from 'node:crypto';
import { BusinessConflictError, ErrorCode } from '@ledgerflow/errors';
import { MAX_MINOR } from '@ledgerflow/money';

export type SettlementItemType = 'CAPTURE' | 'REFUND' | 'FEE' | 'CHARGEBACK' | 'ADJUSTMENT';

export interface SettlementItem {
  readonly itemType: SettlementItemType;
  readonly sourceId: string;
  readonly amountMinor: bigint;
  readonly currency: string;
}

export interface SettlementTotals {
  readonly gross: bigint;
  readonly fees: bigint;
  readonly refunds: bigint;
  readonly chargebacks: bigint;
  readonly adjustments: bigint;
  readonly net: bigint;
}

export interface FeeSchedule {
  readonly basisPoints: bigint;
  readonly fixedMinor: bigint;
  /** Recorded on the snapshot so a later schedule change cannot rewrite history. */
  readonly version: string;
}

/**
 * net = gross − refunds − chargebacks − fees + adjustments.
 * Percentage fees use floor division, which is the versioned rounding rule.
 */
export function calculateSettlement(
  items: readonly SettlementItem[],
  fee: FeeSchedule,
  currency: string,
): SettlementTotals {
  if (fee.basisPoints < 0n || fee.basisPoints > 10_000n || fee.fixedMinor < 0n) {
    throw new BusinessConflictError(ErrorCode.VALIDATION_FAILED, 'Fee schedule is out of range.');
  }

  let gross = 0n;
  let refunds = 0n;
  let chargebacks = 0n;
  let adjustments = 0n;

  for (const item of items) {
    if (item.currency !== currency) {
      throw new BusinessConflictError(
        ErrorCode.CURRENCY_MISMATCH,
        'A settlement cannot mix currencies.',
        {
          currency,
          itemCurrency: item.currency,
        },
      );
    }
    if (item.itemType !== 'ADJUSTMENT' && item.amountMinor <= 0n) {
      throw new BusinessConflictError(
        ErrorCode.INVALID_MONEY_AMOUNT,
        'Settlement item amount must be positive.',
      );
    }
    switch (item.itemType) {
      case 'CAPTURE':
        gross += item.amountMinor;
        break;
      case 'REFUND':
        refunds += item.amountMinor;
        break;
      case 'CHARGEBACK':
        chargebacks += item.amountMinor;
        break;
      case 'ADJUSTMENT':
        adjustments += item.amountMinor;
        break;
      case 'FEE':
        break;
    }
  }

  const fees = (gross * fee.basisPoints) / 10_000n + fee.fixedMinor;
  const net = gross - refunds - chargebacks - fees + adjustments;

  for (const value of [
    gross,
    refunds,
    chargebacks,
    fees,
    adjustments < 0n ? -adjustments : adjustments,
    net < 0n ? -net : net,
  ]) {
    if (value > MAX_MINOR) {
      throw new BusinessConflictError(
        ErrorCode.INVALID_MONEY_AMOUNT,
        'Settlement total is outside the 64-bit range.',
      );
    }
  }

  return { gross, fees, refunds, chargebacks, adjustments, net };
}

/** SHA-256 over the ordered economic inputs. Recalculation must reproduce it. */
export function settlementDigest(
  items: readonly SettlementItem[],
  fee: FeeSchedule,
  currency: string,
): string {
  const lines = [...items]
    .map(
      (item) => `${item.itemType}|${item.sourceId}|${item.amountMinor.toString()}|${item.currency}`,
    )
    .sort();
  const body = [
    `currency=${currency}`,
    `fee=${fee.version}:${fee.basisPoints}:${fee.fixedMinor}`,
    ...lines,
  ].join('\n');
  return createHash('sha256').update(body).digest('hex');
}
