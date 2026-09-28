import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { CurrentPrincipal, Permission, RequirePermissions, type Principal } from '@ledgerflow/auth';
import {
  CreateMerchantRequestSchema,
  MerchantStatusChangeSchema,
  UpdateSettlementConfigSchema,
  UuidSchema,
  ZodValidationPipe,
  type CreateMerchantRequest,
  type MerchantResponse,
  type MerchantStatus,
  type MerchantStatusChange,
  type SettlementConfigResponse,
  type UpdateSettlementConfig,
} from '@ledgerflow/contracts';
import { ValidationError } from '@ledgerflow/errors';
import { MerchantService } from './merchant.service';

@Controller('merchants')
export class MerchantController {
  constructor(private readonly merchants: MerchantService) {}

  @Post()
  @RequirePermissions(Permission.MERCHANTS_WRITE)
  async onboard(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(CreateMerchantRequestSchema)) body: CreateMerchantRequest,
  ): Promise<MerchantResponse> {
    return this.merchants.onboard(principal, body);
  }

  @Get()
  @RequirePermissions(Permission.MERCHANTS_READ)
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ): Promise<{ merchants: MerchantResponse[] }> {
    const parsedLimit = limit === undefined ? 50 : Number.parseInt(limit, 10);
    if (Number.isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 200) {
      throw new ValidationError('limit must be between 1 and 200.');
    }

    return {
      merchants: await this.merchants.list(principal, {
        ...(status === undefined ? {} : { status: status as MerchantStatus }),
        limit: parsedLimit,
      }),
    };
  }

  @Get(':id')
  @RequirePermissions(Permission.MERCHANTS_READ)
  async get(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
  ): Promise<MerchantResponse> {
    return this.merchants.get(principal, parseId(id));
  }

  @Post(':id/activate')
  @HttpCode(200)
  @RequirePermissions(Permission.MERCHANTS_WRITE)
  async activate(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(MerchantStatusChangeSchema)) body: MerchantStatusChange,
  ): Promise<MerchantResponse> {
    return this.merchants.changeStatus(principal, parseId(id), 'MERCHANT_ACTIVE', body.reason);
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @RequirePermissions(Permission.MERCHANTS_WRITE)
  async suspend(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(MerchantStatusChangeSchema)) body: MerchantStatusChange,
  ): Promise<MerchantResponse> {
    return this.merchants.changeStatus(principal, parseId(id), 'MERCHANT_SUSPENDED', body.reason);
  }

  @Post(':id/close')
  @HttpCode(200)
  @RequirePermissions(Permission.MERCHANTS_WRITE)
  async close(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(MerchantStatusChangeSchema)) body: MerchantStatusChange,
  ): Promise<MerchantResponse> {
    return this.merchants.changeStatus(principal, parseId(id), 'MERCHANT_CLOSED', body.reason);
  }

  @Get(':id/settlement-config')
  @RequirePermissions(Permission.MERCHANTS_READ)
  async getSettlementConfig(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
  ): Promise<SettlementConfigResponse> {
    return this.merchants.getSettlementConfig(principal, parseId(id));
  }

  @Put(':id/settlement-config')
  @RequirePermissions(Permission.MERCHANTS_WRITE)
  async updateSettlementConfig(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateSettlementConfigSchema)) body: UpdateSettlementConfig,
  ): Promise<SettlementConfigResponse> {
    return this.merchants.updateSettlementConfig(principal, parseId(id), body);
  }
}

function parseId(id: string): string {
  const parsed = UuidSchema.safeParse(id);
  if (!parsed.success) {
    throw new ValidationError('Merchant id must be a UUID.');
  }
  return parsed.data;
}
