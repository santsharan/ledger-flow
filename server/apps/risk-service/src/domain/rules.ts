/**
 * Deterministic risk rules. A later model-based engine can implement the same interface
 * without changing callers.
 */
export interface RiskInput {
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly merchantAgeDays: number;
  readonly merchantRecentCount: number;
  readonly customerRecentCount: number;
  readonly failedAttempts: number;
  /** Lifetime count, distinct from the recent velocity windows. */
  readonly historicalTransactionCount: number;
  readonly country: string;
  readonly ipRisk: 'LOW' | 'MEDIUM' | 'HIGH';
  readonly deviceRisk: 'LOW' | 'MEDIUM' | 'HIGH';
}

export type RiskDecisionName = 'APPROVE' | 'REVIEW' | 'DECLINE';

export interface RiskDecision {
  readonly decision: RiskDecisionName;
  readonly riskScore: number;
  readonly reasonCodes: readonly string[];
}

export interface RiskEngine {
  evaluate(input: RiskInput): RiskDecision;
}

const ALLOWED_COUNTRIES = new Set(['IN', 'US', 'GB', 'SG', 'AE']);

export class RulesRiskEngine implements RiskEngine {
  evaluate(input: RiskInput): RiskDecision {
    const reasonCodes: string[] = [];
    let score = 0;
    let decline = false;

    if (input.amountMinor >= 2_000_000n) {
      decline = true;
      score += 80;
      reasonCodes.push('HIGH_AMOUNT');
    } else if (input.amountMinor >= 500_000n) {
      score += 40;
      reasonCodes.push('HIGH_AMOUNT');
    }

    if (input.merchantRecentCount >= 50 || input.customerRecentCount >= 30) {
      decline = true;
      score += 70;
      reasonCodes.push('HIGH_VELOCITY');
    } else if (input.merchantRecentCount >= 20 || input.customerRecentCount >= 10) {
      score += 30;
      reasonCodes.push('HIGH_VELOCITY');
    }

    if (input.merchantAgeDays < 7 && input.amountMinor >= 100_000n) {
      score += 25;
      reasonCodes.push('NEW_MERCHANT');
    }

    if (input.historicalTransactionCount >= 250) {
      score += 25;
      reasonCodes.push('HISTORICAL_VOLUME');
    } else if (input.historicalTransactionCount >= 100) {
      score += 15;
      reasonCodes.push('HISTORICAL_VOLUME');
    }

    if (input.failedAttempts >= 5) {
      decline = true;
      score += 60;
      reasonCodes.push('REPEATED_FAILURES');
    } else if (input.failedAttempts >= 3) {
      score += 25;
      reasonCodes.push('REPEATED_FAILURES');
    }

    if (!ALLOWED_COUNTRIES.has(input.country)) {
      score += 20;
      reasonCodes.push('COUNTRY_NOT_ALLOWED');
    }

    if (input.ipRisk === 'HIGH' || input.deviceRisk === 'HIGH') {
      score += 35;
      reasonCodes.push('ELEVATED_DEVICE_OR_IP');
    } else if (input.ipRisk === 'MEDIUM' || input.deviceRisk === 'MEDIUM') {
      score += 10;
      reasonCodes.push('ELEVATED_DEVICE_OR_IP');
    }

    const decision: RiskDecisionName = decline ? 'DECLINE' : score >= 25 ? 'REVIEW' : 'APPROVE';
    return { decision, riskScore: Math.min(score, 100), reasonCodes };
  }
}
