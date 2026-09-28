import { SETTLEMENT_STATUSES, type SettlementStatus } from './settlement-state';
import { BusinessConflictError } from '@ledgerflow/errors';
import { describe, expect, it } from 'vitest';
import {
  assertSettlementTransition,
  assertWithinPayable,
  canTransitionSettlement,
} from './settlement-state';

const LEGAL: ReadonlyArray<readonly [SettlementStatus, SettlementStatus]> = [
  ['CREATED', 'CALCULATING'],
  ['CALCULATING', 'CALCULATED'],
  ['CALCULATING', 'FAILED'],
  ['CALCULATED', 'APPROVED'],
  ['CALCULATED', 'FAILED'],
  ['APPROVED', 'SUBMITTED'],
  ['SUBMITTED', 'CONFIRMED'],
  ['SUBMITTED', 'SETTLEMENT_UNKNOWN'],
  ['SUBMITTED', 'FAILED'],
  ['SETTLEMENT_UNKNOWN', 'CONFIRMED'],
  ['SETTLEMENT_UNKNOWN', 'FAILED'],
  ['CONFIRMED', 'REVERSED'],
];

describe('settlement state machine', () => {
  it('allows exactly the documented transitions', () => {
    const legal = new Set(LEGAL.map(([from, to]) => `${from}->${to}`));
    for (const from of SETTLEMENT_STATUSES) {
      for (const to of SETTLEMENT_STATUSES) {
        expect(canTransitionSettlement(from, to), `${from}->${to}`).toBe(
          legal.has(`${from}->${to}`),
        );
      }
    }
  });

  it('refuses a second confirmation as a business conflict', () => {
    expect(() => assertSettlementTransition('CONFIRMED', 'REVERSED')).not.toThrow();
    expect(() => assertSettlementTransition('REVERSED', 'CONFIRMED')).toThrow(
      BusinessConflictError,
    );
  });

  it('refuses a net above the payable balance', () => {
    expect(() => assertWithinPayable(100n, 100n)).not.toThrow();
    try {
      assertWithinPayable(101n, 100n);
      expect.unreachable('expected the payable check to fail');
    } catch (error) {
      expect((error as BusinessConflictError).code).toBe('SETTLEMENT_EXCEEDS_PAYABLE');
    }
  });
});
