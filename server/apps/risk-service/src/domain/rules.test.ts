import { describe, expect, it } from 'vitest';
import { RulesRiskEngine, type RiskEngine, type RiskInput } from './rules';

const engine: RiskEngine = new RulesRiskEngine();

function input(overrides: Partial<RiskInput> = {}): RiskInput {
  return {
    amountMinor: 10_000n,
    currency: 'INR',
    merchantAgeDays: 90,
    merchantRecentCount: 1,
    customerRecentCount: 1,
    failedAttempts: 0,
    historicalTransactionCount: 0,
    country: 'IN',
    ipRisk: 'LOW',
    deviceRisk: 'LOW',
    ...overrides,
  };
}

describe('RulesRiskEngine', () => {
  it('approves an ordinary payment', () => {
    expect(engine.evaluate(input())).toMatchObject({ decision: 'APPROVE', reasonCodes: [] });
  });

  it('reviews a high amount and declines an extreme one', () => {
    expect(engine.evaluate(input({ amountMinor: 500_000n })).decision).toBe('REVIEW');
    expect(engine.evaluate(input({ amountMinor: 2_000_000n })).decision).toBe('DECLINE');
  });

  it('declines high velocity and repeated failures', () => {
    expect(engine.evaluate(input({ merchantRecentCount: 50 })).reasonCodes).toContain(
      'HIGH_VELOCITY',
    );
    expect(engine.evaluate(input({ merchantRecentCount: 50 })).decision).toBe('DECLINE');
    expect(engine.evaluate(input({ failedAttempts: 5 })).decision).toBe('DECLINE');
  });

  it('reviews a new merchant taking a large payment', () => {
    const decision = engine.evaluate(input({ merchantAgeDays: 1, amountMinor: 100_000n }));
    expect(decision.decision).toBe('REVIEW');
    expect(decision.reasonCodes).toContain('NEW_MERCHANT');
  });

  it('reviews a long transaction history', () => {
    const decision = engine.evaluate(input({ historicalTransactionCount: 250 }));
    expect(decision.decision).toBe('REVIEW');
    expect(decision.reasonCodes).toContain('HISTORICAL_VOLUME');
  });

  it('is deterministic for the same input', () => {
    const sample = input({ ipRisk: 'HIGH', country: 'BR', failedAttempts: 3 });
    expect(engine.evaluate(sample)).toEqual(engine.evaluate(sample));
  });
});
