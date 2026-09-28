import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { CurrentPrincipal, Permission, RequirePermissions, type Principal } from '@ledgerflow/auth';
import { UuidSchema, ZodValidationPipe } from '@ledgerflow/contracts';
import { ValidationError } from '@ledgerflow/errors';
import { z } from 'zod';
import { type CaseStatus } from './domain/case-state';
import { ReconciliationService, type RunView } from './reconciliation.service';

const InternalSchema = z.object({
  paymentReference: z.string().min(1),
  providerReference: z.string().nullable(),
  amountMinor: z.string().regex(/^\d+$/),
  currency: z.string().length(3),
  settlementDate: z.string().min(8),
  status: z.string().min(1),
});

const RunSchema = z.object({
  provider: z.string().min(1),
  format: z.enum(['CSV', 'JSON']),
  statement: z.unknown(),
  internal: z.array(InternalSchema),
});

const ResolveSchema = z.object({
  to: z.enum(['INVESTIGATING', 'ESCALATED', 'RESOLVED', 'IGNORED_WITH_REASON']),
  reason: z.string().min(3).max(500),
});

@Controller('reconciliation')
export class ReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}

  @Post('runs')
  @RequirePermissions(Permission.RECONCILIATION_READ)
  run(@Body(new ZodValidationPipe(RunSchema)) body: z.infer<typeof RunSchema>): Promise<RunView> {
    return this.reconciliation.run({
      provider: body.provider,
      format: body.format,
      statement: body.statement,
      internal: body.internal.map((row) => ({
        ...row,
        amountMinor: BigInt(row.amountMinor),
      })),
    });
  }

  @Get('cases')
  @RequirePermissions(Permission.RECONCILIATION_READ)
  listCases(): ReturnType<ReconciliationService['listCases']> {
    return this.reconciliation.listCases();
  }

  @Get('cases/:id')
  @RequirePermissions(Permission.RECONCILIATION_READ)
  getCase(@Param('id') id: string): ReturnType<ReconciliationService['getCase']> {
    const parsed = UuidSchema.safeParse(id);
    if (!parsed.success) throw new ValidationError('Case id must be a UUID.');
    return this.reconciliation.getCase(parsed.data);
  }

  @Post('cases/:id/resolve')
  @HttpCode(200)
  @RequirePermissions(Permission.RECONCILIATION_RESOLVE)
  resolve(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ResolveSchema)) body: z.infer<typeof ResolveSchema>,
  ): Promise<{ status: CaseStatus }> {
    const parsed = UuidSchema.safeParse(id);
    if (!parsed.success) throw new ValidationError('Case id must be a UUID.');
    return this.reconciliation.resolve(principal, parsed.data, body.to, body.reason);
  }
}
