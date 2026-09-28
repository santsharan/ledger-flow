import { Injectable } from '@nestjs/common';
import { type Executor } from '@ledgerflow/database';
import { type MerchantStatus } from '@ledgerflow/contracts';

export interface MerchantRecord {
  readonly id: string;
  readonly legalName: string;
  readonly displayName: string;
  readonly country: string;
  readonly contactEmail: string;
  readonly status: MerchantStatus;
  readonly settlementCurrency: string;
  readonly version: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface SettlementConfigRecord {
  readonly merchantId: string;
  readonly settlementSchedule: string;
  readonly feeBasisPoints: number;
  readonly fixedFeeMinor: string;
  readonly holdPeriodDays: number;
  readonly currency: string;
  readonly updatedAt: Date;
}

interface MerchantRow {
  id: string;
  legal_name: string;
  display_name: string;
  country: string;
  contact_email: string;
  status: MerchantStatus;
  settlement_currency: string;
  version: string;
  created_at: Date;
  updated_at: Date;
}

const MERCHANT_COLUMNS = `id, legal_name, display_name, country, contact_email, status,
                          settlement_currency, version, created_at, updated_at`;

@Injectable()
export class MerchantRepository {
  async create(
    executor: Executor,
    input: {
      legalName: string;
      displayName: string;
      country: string;
      contactEmail: string;
      settlementCurrency: string;
    },
  ): Promise<MerchantRecord> {
    const result = await executor.query<MerchantRow>(
      `INSERT INTO merchants (legal_name, display_name, country, contact_email, settlement_currency)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${MERCHANT_COLUMNS}`,
      [
        input.legalName,
        input.displayName,
        input.country,
        input.contactEmail,
        input.settlementCurrency,
      ],
    );

    return toMerchant(result.rows[0]!);
  }

  async findById(executor: Executor, id: string): Promise<MerchantRecord | null> {
    const result = await executor.query<MerchantRow>(
      `SELECT ${MERCHANT_COLUMNS} FROM merchants WHERE id = $1`,
      [id],
    );

    return result.rows[0] === undefined ? null : toMerchant(result.rows[0]);
  }

  /**
   * Locks the merchant row for a status transition, so two concurrent suspend/activate calls
   * cannot both read `MERCHANT_ACTIVE` and both proceed.
   */
  async lockById(executor: Executor, id: string): Promise<MerchantRecord | null> {
    const result = await executor.query<MerchantRow>(
      `SELECT ${MERCHANT_COLUMNS} FROM merchants WHERE id = $1 FOR UPDATE`,
      [id],
    );

    return result.rows[0] === undefined ? null : toMerchant(result.rows[0]);
  }

  async list(
    executor: Executor,
    options: { status?: MerchantStatus; limit: number },
  ): Promise<MerchantRecord[]> {
    const result =
      options.status === undefined
        ? await executor.query<MerchantRow>(
            `SELECT ${MERCHANT_COLUMNS} FROM merchants ORDER BY created_at DESC LIMIT $1`,
            [options.limit],
          )
        : await executor.query<MerchantRow>(
            `SELECT ${MERCHANT_COLUMNS} FROM merchants
             WHERE status = $1 ORDER BY created_at DESC LIMIT $2`,
            [options.status, options.limit],
          );

    return result.rows.map(toMerchant);
  }

  async updateStatus(
    executor: Executor,
    input: {
      merchantId: string;
      expectedVersion: string;
      newStatus: MerchantStatus;
    },
  ): Promise<MerchantRecord | null> {
    const result = await executor.query<MerchantRow>(
      `UPDATE merchants
       SET status = $1, version = version + 1, updated_at = now()
       WHERE id = $2 AND version = $3
       RETURNING ${MERCHANT_COLUMNS}`,
      [input.newStatus, input.merchantId, input.expectedVersion],
    );

    return result.rows[0] === undefined ? null : toMerchant(result.rows[0]);
  }

  async recordStatusChange(
    executor: Executor,
    input: {
      merchantId: string;
      previousStatus: string;
      newStatus: string;
      reason: string;
      actorId: string;
      actorType: string;
    },
  ): Promise<void> {
    await executor.query(
      `INSERT INTO merchant_status_history
         (merchant_id, previous_status, new_status, reason, actor_id, actor_type)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.merchantId,
        input.previousStatus,
        input.newStatus,
        input.reason,
        input.actorId,
        input.actorType,
      ],
    );
  }

  async createSettlementConfig(
    executor: Executor,
    input: {
      merchantId: string;
      settlementSchedule: string;
      feeBasisPoints: number;
      fixedFeeMinor: string;
      currency: string;
    },
  ): Promise<SettlementConfigRecord> {
    const result = await executor.query<{
      merchant_id: string;
      settlement_schedule: string;
      fee_basis_points: number;
      fixed_fee_minor: string;
      hold_period_days: number;
      currency: string;
      updated_at: Date;
    }>(
      `INSERT INTO merchant_settlement_config
         (merchant_id, settlement_schedule, fee_basis_points, fixed_fee_minor, currency)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING merchant_id, settlement_schedule, fee_basis_points, fixed_fee_minor,
                 hold_period_days, currency, updated_at`,
      [
        input.merchantId,
        input.settlementSchedule,
        input.feeBasisPoints,
        input.fixedFeeMinor,
        input.currency,
      ],
    );

    return toConfig(result.rows[0]!);
  }

  async findSettlementConfig(
    executor: Executor,
    merchantId: string,
  ): Promise<SettlementConfigRecord | null> {
    const result = await executor.query<{
      merchant_id: string;
      settlement_schedule: string;
      fee_basis_points: number;
      fixed_fee_minor: string;
      hold_period_days: number;
      currency: string;
      updated_at: Date;
    }>(
      `SELECT merchant_id, settlement_schedule, fee_basis_points, fixed_fee_minor,
              hold_period_days, currency, updated_at
       FROM merchant_settlement_config WHERE merchant_id = $1`,
      [merchantId],
    );

    return result.rows[0] === undefined ? null : toConfig(result.rows[0]);
  }

  async updateSettlementConfig(
    executor: Executor,
    input: {
      merchantId: string;
      settlementSchedule: string;
      feeBasisPoints: number;
      fixedFeeMinor: string;
      holdPeriodDays: number;
    },
  ): Promise<SettlementConfigRecord> {
    const result = await executor.query<{
      merchant_id: string;
      settlement_schedule: string;
      fee_basis_points: number;
      fixed_fee_minor: string;
      hold_period_days: number;
      currency: string;
      updated_at: Date;
    }>(
      `UPDATE merchant_settlement_config
       SET settlement_schedule = $2, fee_basis_points = $3, fixed_fee_minor = $4,
           hold_period_days = $5, updated_at = now()
       WHERE merchant_id = $1
       RETURNING merchant_id, settlement_schedule, fee_basis_points, fixed_fee_minor,
                 hold_period_days, currency, updated_at`,
      [
        input.merchantId,
        input.settlementSchedule,
        input.feeBasisPoints,
        input.fixedFeeMinor,
        input.holdPeriodDays,
      ],
    );

    return toConfig(result.rows[0]!);
  }

  async linkLedgerAccount(
    executor: Executor,
    input: { merchantId: string; accountCode: string; currency: string; accountId: string },
  ): Promise<void> {
    await executor.query(
      `INSERT INTO merchant_ledger_accounts (merchant_id, account_code, currency, account_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (merchant_id, account_code, currency) DO NOTHING`,
      [input.merchantId, input.accountCode, input.currency, input.accountId],
    );
  }

  async findLedgerAccounts(
    executor: Executor,
    merchantId: string,
  ): Promise<{ accountCode: string; currency: string; accountId: string }[]> {
    const result = await executor.query<{
      account_code: string;
      currency: string;
      account_id: string;
    }>(
      `SELECT account_code, currency, account_id FROM merchant_ledger_accounts
       WHERE merchant_id = $1 ORDER BY account_code`,
      [merchantId],
    );

    return result.rows.map((row) => ({
      accountCode: row.account_code,
      currency: row.currency,
      accountId: row.account_id,
    }));
  }
}

function toMerchant(row: MerchantRow): MerchantRecord {
  return {
    id: row.id,
    legalName: row.legal_name,
    displayName: row.display_name,
    country: row.country,
    contactEmail: row.contact_email,
    status: row.status,
    settlementCurrency: row.settlement_currency,
    version: String(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toConfig(row: {
  merchant_id: string;
  settlement_schedule: string;
  fee_basis_points: number;
  fixed_fee_minor: string;
  hold_period_days: number;
  currency: string;
  updated_at: Date;
}): SettlementConfigRecord {
  return {
    merchantId: row.merchant_id,
    settlementSchedule: row.settlement_schedule,
    feeBasisPoints: row.fee_basis_points,
    fixedFeeMinor: String(row.fixed_fee_minor),
    holdPeriodDays: row.hold_period_days,
    currency: row.currency,
    updatedAt: row.updated_at,
  };
}
