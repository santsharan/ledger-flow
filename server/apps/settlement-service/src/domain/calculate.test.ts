import { BusinessConflictError } from '@ledgerflow/errors';
import { describe, expect, it } from 'vitest';
import {
  calculateSettlement,
  settlementDigest,
  type FeeSchedule,
  type SettlementItem,
} from './calculate';

const fee: FeeSchedule = { basisPoints: 250n, fixedMinor: 0n, version: 'fee-v1' };

function item(
  itemType: SettlementItem['itemType'],
  amountMinor: bigint,
  sourceId: string = itemType,
): SettlementItem {
  return { itemType, sourceId, amountMinor, currency: 'INR' };
}

describe('calculateSettlement', () => {
  it('computes net from captures, refunds, fees, chargebacks and adjustments', () => {
    const totals = calculateSettlement(
      [
        item('CAPTURE', 100_000n, 'pay-1'),
        item('REFUND', 5_000n, 'ref-1'),
        item('CHARGEBACK', 1_000n, 'cb-1'),
        item('ADJUSTMENT', -500n, 'adj-1'),
      ],
      fee,
      'INR',
    );

    // 2.5% of 100000 = 2500, floored.
    expect(totals).toEqual({
      gross: 100_000n,
      fees: 2_500n,
      refunds: 5_000n,
      chargebacks: 1_000n,
      adjustments: -500n,
      net: 91_000n,
    });
    expect(
      totals.gross - totals.refunds - totals.chargebacks - totals.fees + totals.adjustments,
    ).toBe(totals.net);
  });

  it('floors a fractional basis-point fee', () => {
    const totals = calculateSettlement(
      [item('CAPTURE', 10n, 'pay-1')],
      { basisPoints: 250n, fixedMinor: 200n, version: 'fee-v1' },
      'INR',
    );
    // floor(10 * 250 / 10000) = floor(0.25) = 0, plus fixed 200.
    expect(totals.fees).toBe(200n);
    expect(totals.net).toBe(-190n);
  });

  it('refuses mixed currencies', () => {
    expect(() =>
      calculateSettlement([{ ...item('CAPTURE', 100n), currency: 'USD' }], fee, 'INR'),
    ).toThrow(BusinessConflictError);
  });

  it('reproduces the snapshot digest from the stored items', () => {
    const items = [item('CAPTURE', 100_000n, 'pay-1'), item('REFUND', 5_000n, 'ref-1')];
    const first = settlementDigest(items, fee, 'INR');
    const reordered = settlementDigest([items[1]!, items[0]!], fee, 'INR');
    expect(first).toBe(reordered);
    expect(settlementDigest(items, { ...fee, version: 'fee-v2' }, 'INR')).not.toBe(first);
  });
});
