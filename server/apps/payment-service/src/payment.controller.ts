import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import { CurrentPrincipal, Permission, RequirePermissions, type Principal } from '@ledgerflow/auth';
import {
  CreatePaymentRequestSchema,
  IdempotencyKeySchema,
  MoneyOperationRequestSchema,
  UuidSchema,
  ZodValidationPipe,
  type CreatePaymentRequest,
  type MoneyOperationRequest,
} from '@ledgerflow/contracts';
import { AppError, ErrorCode, ValidationError } from '@ledgerflow/errors';
import { PAYMENT_STATUSES, type PaymentStatus } from './domain/payment-state';
import { PaymentService, type PaymentView } from './payment.service';

@Controller('payments')
export class PaymentController {
  constructor(private readonly payments: PaymentService) {}

  @Post()
  @RequirePermissions(Permission.PAYMENTS_CREATE)
  create(
    @CurrentPrincipal() principal: Principal,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(CreatePaymentRequestSchema)) body: CreatePaymentRequest,
  ): Promise<PaymentView> {
    return this.payments.create(principal, requireIdempotencyKey(idempotencyKey), body);
  }

  @Get()
  @RequirePermissions(Permission.PAYMENTS_READ)
  async list(
    @CurrentPrincipal() principal: Principal,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<{ payments: Awaited<ReturnType<PaymentService['list']>> }> {
    return {
      payments: await this.payments.list(principal, {
        limit: parseLimit(limit),
        offset: parseOffset(offset),
        ...parseStatus(status),
      }),
    };
  }

  @Get(':id')
  @RequirePermissions(Permission.PAYMENTS_READ)
  get(@CurrentPrincipal() principal: Principal, @Param('id') id: string): Promise<PaymentView> {
    return this.payments.get(principal, parseId(id));
  }

  @Post(':id/authorize')
  @HttpCode(200)
  @RequirePermissions(Permission.PAYMENTS_CREATE)
  authorize(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ): Promise<PaymentView> {
    return this.payments.authorize(principal, parseId(id), requireIdempotencyKey(idempotencyKey));
  }

  @Post(':id/capture')
  @HttpCode(200)
  @RequirePermissions(Permission.PAYMENTS_CAPTURE)
  capture(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(MoneyOperationRequestSchema)) body: MoneyOperationRequest,
  ): Promise<PaymentView> {
    return this.payments.capture(
      principal,
      parseId(id),
      requireIdempotencyKey(idempotencyKey),
      body.amountMinor === undefined ? undefined : BigInt(body.amountMinor),
    );
  }

  @Post(':id/refund')
  @HttpCode(200)
  @RequirePermissions(Permission.PAYMENTS_REFUND)
  refund(
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(MoneyOperationRequestSchema)) body: MoneyOperationRequest,
  ): Promise<PaymentView> {
    return this.payments.refund(
      principal,
      parseId(id),
      requireIdempotencyKey(idempotencyKey),
      body.amountMinor === undefined ? undefined : BigInt(body.amountMinor),
    );
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @RequirePermissions(Permission.PAYMENTS_CAPTURE)
  resolve(@CurrentPrincipal() principal: Principal, @Param('id') id: string): Promise<PaymentView> {
    return this.payments.resolve(principal, parseId(id));
  }

  @Post(':id/ledger-postings')
  @HttpCode(200)
  @RequirePermissions(Permission.PAYMENTS_CAPTURE)
  postLedger(@CurrentPrincipal() principal: Principal, @Param('id') id: string): Promise<PaymentView> {
    return this.payments.postPendingLedger(principal, parseId(id));
  }
}

function requireIdempotencyKey(value: string | undefined): string {
  const parsed = IdempotencyKeySchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError({
      code: ErrorCode.IDEMPOTENCY_KEY_REQUIRED,
      message: 'A valid Idempotency-Key header is required.',
      httpStatus: 400,
      category: 'PERMANENT',
    });
  }
  return parsed.data;
}

function parseLimit(limit: string | undefined): number {
  if (limit === undefined || limit === '') return 50;
  const parsed = Number.parseInt(limit, 10);
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 200) {
    throw new ValidationError('limit must be between 1 and 200.');
  }
  return parsed;
}

function parseOffset(offset: string | undefined): number {
  if (offset === undefined || offset === '') return 0;
  const parsed = Number.parseInt(offset, 10);
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 10_000) {
    throw new ValidationError('offset must be between 0 and 10000.');
  }
  return parsed;
}

function parseStatus(status: string | undefined): { status?: PaymentStatus } {
  if (status === undefined || status === '') return {};
  if (!(PAYMENT_STATUSES as readonly string[]).includes(status)) {
    throw new ValidationError('status is not a payment status.');
  }
  return { status: status as PaymentStatus };
}

function parseId(id: string): string {
  const parsed = UuidSchema.safeParse(id);
  if (!parsed.success) throw new ValidationError('Payment id must be a UUID.');
  return parsed.data;
}
