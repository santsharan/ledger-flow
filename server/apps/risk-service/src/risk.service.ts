import { Injectable } from '@nestjs/common';
import { Database } from '@ledgerflow/database';
import {
  RulesRiskEngine,
  type RiskDecision,
  type RiskEngine,
  type RiskInput,
} from './domain/rules';

export interface StoredRiskDecision extends RiskDecision {
  readonly id: string;
  readonly engine: string;
}

/**
 * The HTTP layer depends on RiskEngine, not on RulesRiskEngine.
 * A model-based implementation can be substituted here without changing the API.
 */
@Injectable()
export class RiskService {
  private readonly engine: RiskEngine = new RulesRiskEngine();

  constructor(private readonly database: Database) {}

  async evaluate(input: RiskInput): Promise<StoredRiskDecision> {
    const decision = this.engine.evaluate(input);
    const stored = await this.database.query<{ id: string }>(
      `INSERT INTO risk_evaluations (
         amount_minor, currency, merchant_age_days, merchant_recent_count, customer_recent_count,
         historical_transaction_count, failed_attempts, country, ip_risk, device_risk,
         decision, risk_score, reason_codes, engine
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14)
       RETURNING id`,
      [
        input.amountMinor.toString(),
        input.currency,
        input.merchantAgeDays,
        input.merchantRecentCount,
        input.customerRecentCount,
        input.historicalTransactionCount,
        input.failedAttempts,
        input.country,
        input.ipRisk,
        input.deviceRisk,
        decision.decision,
        decision.riskScore,
        JSON.stringify(decision.reasonCodes),
        'rules',
      ],
    );

    return { ...decision, id: stored.rows[0]!.id, engine: 'rules' };
  }
}
