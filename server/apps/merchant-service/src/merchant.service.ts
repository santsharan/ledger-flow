import { Inject, Injectable } from '@nestjs/common';
import { writeAudit } from '@ledgerflow/audit';
import { assertMerchantAccess, type Principal } from '@ledgerflow/auth';
import {
  type CreateMerchantRequest,
  type MerchantResponse,
  type MerchantStatus,
  type SettlementConfigResponse,
  type UpdateSettlementConfig,
} from '@ledgerflow/contracts';
import { Database } from '@ledgerflow/database';
import { ErrorCode, NotFoundError } from '@ledgerflow/errors';
import { type Logger } from '@ledgerflow/logger';
import { getCurrency } from '@ledgerflow/money';
import { getRequestContext, LOGGER } from '@ledgerflow/service-core';
import { assertTransition } from './merchant-status';
import { MerchantRepository, type MerchantRecord } from './merchant.repository';

@Injectable()
export class MerchantService {
  constructor(
    private readonly database: Database,
    private readonly merchants: MerchantRepository,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async onboard(actor: Principal, request: CreateMerchantRequest): Promise<MerchantResponse> {
    // Fails fast on an unsupported currency rather than storing one the ledger cannot use.
    getCurrency(request.settlementCurrency);

    return this.database.withTransaction(async (tx) => {
      const merchant = await this.merchants.create(tx, {
        legalName: request.legalName,
        displayName: request.displayName,
        country: request.country,
        contactEmail: request.contactEmail,
        settlementCurrency: request.settlementCurrency,
      });

      await this.merchants.createSettlementConfig(tx, {
        merchantId: merchant.id,
        settlementSchedule: request.settlementSchedule,
        feeBasisPoints: request.feeBasisPoints,
        fixedFeeMinor: request.fixedFeeMinor,
        currency: request.settlementCurrency,
      });

      await writeAudit(tx, {
        actorType: actor.actorType === 'SERVICE' ? 'SERVICE' : 'USER',
        actorId: actor.id,
        action: 'merchant.onboarded',
        resourceType: 'merchant',
        resourceId: merchant.id,
        afterState: {
          legalName: merchant.legalName,
          country: merchant.country,
          status: merchant.status,
          settlementCurrency: merchant.settlementCurrency,
        },
        ...auditContext(),
      });

      this.logger.info(
        { event: 'merchant.onboarded', merchantId: merchant.id },
        'merchant onboarded',
      );

      return toResponse(merchant);
    });
  }

  async get(actor: Principal, merchantId: string): Promise<MerchantResponse> {
    assertMerchantAccess(actor, merchantId);

    const merchant = await this.merchants.findById(this.database, merchantId);
    if (merchant === null) {
      throw new NotFoundError(ErrorCode.MERCHANT_NOT_FOUND, 'Merchant not found.');
    }

    return toResponse(merchant);
  }

  async list(
    actor: Principal,
    options: { status?: MerchantStatus; limit: number },
  ): Promise<MerchantResponse[]> {
    // A merchant-scoped caller sees only its own merchant, whatever the filter says.
    if (actor.merchantId !== undefined) {
      const merchant = await this.merchants.findById(this.database, actor.merchantId);
      return merchant === null ? [] : [toResponse(merchant)];
    }

    const merchants = await this.merchants.list(this.database, options);
    return merchants.map(toResponse);
  }

  /**
   * Changes merchant status through the state machine.
   *
   * The row is locked, the transition validated, and the update guarded by the version read
   * under the lock — so concurrent suspend/activate calls cannot interleave.
   */
  async changeStatus(
    actor: Principal,
    merchantId: string,
    newStatus: MerchantStatus,
    reason: string,
  ): Promise<MerchantResponse> {
    assertMerchantAccess(actor, merchantId);

    return this.database.withTransaction(async (tx) => {
      const merchant = await this.merchants.lockById(tx, merchantId);
      if (merchant === null) {
        throw new NotFoundError(ErrorCode.MERCHANT_NOT_FOUND, 'Merchant not found.');
      }

      assertTransition(merchant.status, newStatus);

      const updated = await this.merchants.updateStatus(tx, {
        merchantId,
        expectedVersion: merchant.version,
        newStatus,
      });

      if (updated === null) {
        throw new NotFoundError(ErrorCode.MERCHANT_NOT_FOUND, 'Merchant not found.');
      }

      await this.merchants.recordStatusChange(tx, {
        merchantId,
        previousStatus: merchant.status,
        newStatus,
        reason,
        actorId: actor.id,
        actorType: actor.actorType,
      });

      await writeAudit(tx, {
        actorType: actor.actorType === 'SERVICE' ? 'SERVICE' : 'USER',
        actorId: actor.id,
        action: `merchant.${newStatus.toLowerCase()}`,
        resourceType: 'merchant',
        resourceId: merchantId,
        beforeState: { status: merchant.status },
        afterState: { status: newStatus },
        reason,
        ...auditContext(),
      });

      this.logger.info(
        {
          event: 'merchant.status.changed',
          merchantId,
          from: merchant.status,
          to: newStatus,
        },
        'merchant status changed',
      );

      return toResponse(updated);
    });
  }

  async getSettlementConfig(
    actor: Principal,
    merchantId: string,
  ): Promise<SettlementConfigResponse> {
    assertMerchantAccess(actor, merchantId);

    const config = await this.merchants.findSettlementConfig(this.database, merchantId);
    if (config === null) {
      throw new NotFoundError(ErrorCode.MERCHANT_NOT_FOUND, 'Merchant settlement config not found.');
    }

    return { ...config, updatedAt: config.updatedAt.toISOString() };
  }

  async updateSettlementConfig(
    actor: Principal,
    merchantId: string,
    request: UpdateSettlementConfig,
  ): Promise<SettlementConfigResponse> {
    assertMerchantAccess(actor, merchantId);

    return this.database.withTransaction(async (tx) => {
      const existing = await this.merchants.findSettlementConfig(tx, merchantId);
      if (existing === null) {
        throw new NotFoundError(
          ErrorCode.MERCHANT_NOT_FOUND,
          'Merchant settlement config not found.',
        );
      }

      const updated = await this.merchants.updateSettlementConfig(tx, {
        merchantId,
        settlementSchedule: request.settlementSchedule,
        feeBasisPoints: request.feeBasisPoints,
        fixedFeeMinor: request.fixedFeeMinor,
        holdPeriodDays: request.holdPeriodDays,
      });

      // A fee change is a commercial decision; it is audited with its reason so a disputed
      // settlement can be traced to the configuration that produced it (ADR-010).
      await writeAudit(tx, {
        actorType: actor.actorType === 'SERVICE' ? 'SERVICE' : 'USER',
        actorId: actor.id,
        action: 'merchant.settlement_config.updated',
        resourceType: 'merchant',
        resourceId: merchantId,
        beforeState: {
          settlementSchedule: existing.settlementSchedule,
          feeBasisPoints: existing.feeBasisPoints,
          fixedFeeMinor: existing.fixedFeeMinor,
          holdPeriodDays: existing.holdPeriodDays,
        },
        afterState: {
          settlementSchedule: updated.settlementSchedule,
          feeBasisPoints: updated.feeBasisPoints,
          fixedFeeMinor: updated.fixedFeeMinor,
          holdPeriodDays: updated.holdPeriodDays,
        },
        reason: request.reason,
        ...auditContext(),
      });

      return { ...updated, updatedAt: updated.updatedAt.toISOString() };
    });
  }
}

function toResponse(merchant: MerchantRecord): MerchantResponse {
  return {
    id: merchant.id,
    legalName: merchant.legalName,
    displayName: merchant.displayName,
    country: merchant.country,
    contactEmail: merchant.contactEmail,
    status: merchant.status,
    settlementCurrency: merchant.settlementCurrency,
    createdAt: merchant.createdAt.toISOString(),
    updatedAt: merchant.updatedAt.toISOString(),
  };
}

function auditContext(): { requestId: string | null; correlationId: string | null } {
  const context = getRequestContext();
  return {
    requestId: context?.requestId ?? null,
    correlationId: context?.correlationId ?? null,
  };
}
