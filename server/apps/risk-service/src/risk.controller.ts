import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Permission, RequirePermissions } from '@ledgerflow/auth';
import { ZodValidationPipe } from '@ledgerflow/contracts';
import { z } from 'zod';
import { type RiskInput } from './domain/rules';
import { RiskService, type StoredRiskDecision } from './risk.service';

const EvaluateSchema = z.object({
  amountMinor: z.string().regex(/^\d+$/),
  currency: z.string().length(3),
  merchantAgeDays: z.number().int().min(0),
  merchantRecentCount: z.number().int().min(0),
  customerRecentCount: z.number().int().min(0),
  historicalTransactionCount: z.number().int().min(0),
  failedAttempts: z.number().int().min(0),
  country: z.string().length(2),
  ipRisk: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  deviceRisk: z.enum(['LOW', 'MEDIUM', 'HIGH']),
});

@Controller('risk')
export class RiskController {
  constructor(private readonly risk: RiskService) {}

  @Post('evaluations')
  @HttpCode(200)
  @RequirePermissions(Permission.RISK_READ)
  evaluate(
    @Body(new ZodValidationPipe(EvaluateSchema)) body: z.infer<typeof EvaluateSchema>,
  ): Promise<StoredRiskDecision> {
    const input: RiskInput = { ...body, amountMinor: BigInt(body.amountMinor) };
    return this.risk.evaluate(input);
  }
}
