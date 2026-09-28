import { type MerchantStatus, MERCHANT_STATUSES } from '@ledgerflow/contracts';
import { BusinessConflictError } from '@ledgerflow/errors';
import { describe, expect, it } from 'vitest';
import { assertCanTransact, assertTransition, canTransition } from './merchant-status';

const LEGAL_TRANSITIONS: readonly [MerchantStatus, MerchantStatus][] = [
  ['MERCHANT_PENDING', 'MERCHANT_ACTIVE'],
  ['MERCHANT_PENDING', 'MERCHANT_CLOSED'],
  ['MERCHANT_ACTIVE', 'MERCHANT_SUSPENDED'],
  ['MERCHANT_ACTIVE', 'MERCHANT_CLOSED'],
  ['MERCHANT_SUSPENDED', 'MERCHANT_ACTIVE'],
  ['MERCHANT_SUSPENDED', 'MERCHANT_CLOSED'],
];

describe('merchant status machine', () => {
  it('allows exactly the documented transitions', () => {
    // Exhaustive over every from × to pair: anything not on the list must be refused.
    for (const from of MERCHANT_STATUSES) {
      for (const to of MERCHANT_STATUSES) {
        const expected = LEGAL_TRANSITIONS.some(([f, t]) => f === from && t === to);
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(expected);
      }
    }
  });

  it('never allows a closed merchant to reopen', () => {
    for (const to of MERCHANT_STATUSES) {
      expect(canTransition('MERCHANT_CLOSED', to)).toBe(false);
    }
  });

  it('refuses a self-transition', () => {
    for (const status of MERCHANT_STATUSES) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it('throws a deterministic business conflict on an illegal transition', () => {
    expect(() => assertTransition('MERCHANT_CLOSED', 'MERCHANT_ACTIVE')).toThrow(
      BusinessConflictError,
    );

    try {
      assertTransition('MERCHANT_PENDING', 'MERCHANT_SUSPENDED');
      expect.unreachable('expected the transition to be refused');
    } catch (error) {
      const conflict = error as BusinessConflictError;
      expect(conflict.httpStatus).toBe(409);
      expect(conflict.details).toMatchObject({
        from: 'MERCHANT_PENDING',
        to: 'MERCHANT_SUSPENDED',
      });
    }
  });
});

describe('transaction eligibility', () => {
  it('permits only an active merchant to transact', () => {
    expect(() => assertCanTransact('MERCHANT_ACTIVE')).not.toThrow();

    for (const status of ['MERCHANT_PENDING', 'MERCHANT_SUSPENDED', 'MERCHANT_CLOSED'] as const) {
      expect(() => assertCanTransact(status)).toThrow(BusinessConflictError);
    }
  });

  it('reports MERCHANT_NOT_ACTIVE so callers can branch on the code', () => {
    try {
      assertCanTransact('MERCHANT_SUSPENDED');
      expect.unreachable('expected refusal');
    } catch (error) {
      expect((error as BusinessConflictError).code).toBe('MERCHANT_NOT_ACTIVE');
    }
  });
});
