import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { CurrentPrincipal, Permission, RequirePermissions, type Principal } from '@ledgerflow/auth';
import { UuidSchema, ZodValidationPipe } from '@ledgerflow/contracts';
import { ValidationError } from '@ledgerflow/errors';
import { z } from 'zod';
import { SettlementService, type SettlementView } from './settlement.service';

const ItemSchema = z.object({
  itemType: z.enum(['CAPTURE', 'REFUND', 'FEE', 'CHARGEBACK', 'ADJUSTMENT']),
  sourceId: z.string().min(1).max(128),
  amountMinor: z.string().regex(/^-?\d+$/),
  currency: z.string().length(3),
});

const CreateSchema = z.object({
  merchantId: z.string().uuid(),
  settlementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currency: z.string().length(3),
  feeVersion: z.string().min(1),
  feeBasisPoints: z.number().int().min(0).max(10_000),
  fixedFeeMinor: z.string().regex(/^\d+$/),
  items: z.array(ItemSchema).min(1),
});

const ReasonSchema = z.object({
  reason: z.string().min(3).max(500),
  availablePayableMinor: z
    .string()
    .regex(/^-?\d+$/)
    .optional(),
});

@Controller('settlements')
export class SettlementController {
  constructor(private readonly settlements: SettlementService) {}

  @Post()
  @RequirePermissions(Permission.SETTLEMENTS_APPROVE)
  create(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(CreateSchema)) body: z.infer<typeof CreateSchema>,
  ): Promise<SettlementView> {
    return this.settlements.create(principal, {
      merchantId: body.merchantId,
      settlementDate: body.settlementDate,
      currency: body.currency,
      fee: {
        version: body.feeVersion,
        basisPoints: BigInt(body.feeBasisPoints),
        fixedMinor: BigInt(body.fixedFeeMinor),
      },
      items: body.items.map((item) => ({
        itemType: item.itemType,
        sourceId: item.sourceId,
        amountMinor: BigInt(item.amountMinor),
        currency: item.currency,
      })),
    });
  }

  @Get()
  @RequirePermissions(Permission.SETTLEMENTS_READ)
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<{ settlements: SettlementView[] }> {
    return {
      settlements: await this.settlements.list(principal, {
        limit: parseLimit(limit),
        offset: parseOffset(offset),
      }),
    };
  }

  @Get(':id')
  @RequirePermissions(Permission.SETTLEMENTS_READ)
  get(@CurrentPrincipal() principal: Principal, @Param('id') id: string): Promise<SettlementView> {
    return this.settlements.get(principal, parseId(id));
  }

  @Post(':id/calculate')
  @HttpCode(200)
  @RequirePermissions(Permission.SETTLEMENTS_APPROVE)
  calculate(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
  ): Promise<SettlementView> {
    return this.settlements.calculate(principal, parseId(id));
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermissions(Permission.SETTLEMENTS_APPROVE)
  approve(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReasonSchema)) body: z.infer<typeof ReasonSchema>,
  ): Promise<SettlementView> {
    if (body.availablePayableMinor === undefined) {
      throw new ValidationError('availablePayableMinor is required to approve a settlement.');
    }
    return this.settlements.approve(
      principal,
      parseId(id),
      BigInt(body.availablePayableMinor),
      body.reason,
    );
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermissions(Permission.SETTLEMENTS_APPROVE)
  submit(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReasonSchema)) body: z.infer<typeof ReasonSchema>,
  ): Promise<SettlementView> {
    return this.settlements.submit(principal, parseId(id), body.reason);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  @RequirePermissions(Permission.SETTLEMENTS_APPROVE)
  confirm(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReasonSchema)) body: z.infer<typeof ReasonSchema>,
  ): Promise<SettlementView> {
    return this.settlements.confirm(principal, parseId(id), body.reason);
  }

  @Post(':id/unknown')
  @HttpCode(200)
  @RequirePermissions(Permission.SETTLEMENTS_APPROVE)
  unknown(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReasonSchema)) body: z.infer<typeof ReasonSchema>,
  ): Promise<SettlementView> {
    return this.settlements.markUnknown(principal, parseId(id), body.reason);
  }

  @Post(':id/fail')
  @HttpCode(200)
  @RequirePermissions(Permission.SETTLEMENTS_APPROVE)
  fail(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReasonSchema)) body: z.infer<typeof ReasonSchema>,
  ): Promise<SettlementView> {
    return this.settlements.fail(principal, parseId(id), body.reason);
  }

  @Post(':id/reverse')
  @HttpCode(200)
  @RequirePermissions(Permission.SETTLEMENTS_APPROVE)
  reverse(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReasonSchema)) body: z.infer<typeof ReasonSchema>,
  ): Promise<SettlementView> {
    return this.settlements.reverse(principal, parseId(id), body.reason);
  }

  @Get(':id/reproduction')
  @RequirePermissions(Permission.SETTLEMENTS_READ)
  reproduce(@Param('id') id: string): Promise<{ digest: string; matches: boolean }> {
    return this.settlements.reproduce(parseId(id));
  }
}

function parseOffset(offset: string | undefined): number {
  if (offset === undefined || offset === '') return 0;
  const parsed = Number.parseInt(offset, 10);
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 10_000) {
    throw new ValidationError('offset must be between 0 and 10000.');
  }
  return parsed;
}

function parseLimit(limit: string | undefined): number {
  if (limit === undefined || limit === '') return 50;
  const parsed = Number.parseInt(limit, 10);
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 200) {
    throw new ValidationError('limit must be between 1 and 200.');
  }
  return parsed;
}

function parseId(id: string): string {
  const parsed = UuidSchema.safeParse(id);
  if (!parsed.success) throw new ValidationError('Settlement id must be a UUID.');
  return parsed.data;
}
