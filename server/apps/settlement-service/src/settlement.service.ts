import { Inject, Injectable } from '@nestjs/common';
import { writeAudit } from '@ledgerflow/audit';
import { type Principal } from '@ledgerflow/auth';
import { Database, type Executor } from '@ledgerflow/database';
import { BusinessConflictError, ErrorCode, ForbiddenError, NotFoundError } from '@ledgerflow/errors';
import { type Logger } from '@ledgerflow/logger';
import { LOGGER } from '@ledgerflow/service-core';
import {
  calculateSettlement,
  settlementDigest,
  type FeeSchedule,
  type SettlementItem,
  type SettlementTotals,
} from './domain/calculate';
import {
  assertSettlementTransition,
  assertWithinPayable,
  type SettlementStatus,
} from './domain/settlement-state';

export interface CreateSettlementInput {
  readonly merchantId: string;
  readonly settlementDate: string;
  readonly currency: string;
  readonly fee: FeeSchedule;
  readonly items: readonly SettlementItem[];
}

export interface SettlementView {
  readonly id: string;
  readonly merchantId: string;
  readonly settlementDate: string;
  readonly currency: string;
  readonly status: SettlementStatus;
  readonly totals: {
    readonly gross: string;
    readonly fees: string;
    readonly refunds: string;
    readonly chargebacks: string;
    readonly adjustments: string;
    readonly net: string;
  } | null;
  readonly digest: string | null;
}

interface BatchRow {
  id: string;
  merchant_id: string;
  settlement_date: Date | string;
  currency: string;
  status: SettlementStatus;
  fee_schedule_version: string;
  fee_basis_points: number;
  fixed_fee_minor: string;
  gross_minor: string | null;
  fees_minor: string | null;
  refunds_minor: string | null;
  chargebacks_minor: string | null;
  adjustments_minor: string | null;
  net_minor: string | null;
  version: string;
}

@Injectable()
export class SettlementService {
  constructor(
    private readonly database: Database,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async create(actor: Principal, input: CreateSettlementInput): Promise<SettlementView> {
    return this.database.withTransaction(async (tx) => {
      const inserted = await tx.query<BatchRow>(
        `INSERT INTO settlement_batches (
           merchant_id, settlement_date, currency, fee_schedule_version, fee_basis_points, fixed_fee_minor
         ) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (merchant_id, settlement_date, currency) DO NOTHING
         RETURNING ${BATCH_COLUMNS}`,
        [
          input.merchantId,
          input.settlementDate,
          input.currency,
          input.fee.version,
          input.fee.basisPoints.toString(),
          input.fee.fixedMinor.toString(),
        ],
      );

      if (inserted.rows[0] === undefined) {
        throw new BusinessConflictError(
          ErrorCode.CONFLICT,
          'A settlement already exists for this merchant, date and currency.',
        );
      }

      for (const item of input.items) {
        await tx.query(
          `INSERT INTO settlement_items (batch_id, item_type, source_id, amount_minor, currency)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            inserted.rows[0].id,
            item.itemType,
            item.sourceId,
            item.amountMinor.toString(),
            item.currency,
          ],
        );
      }

      await this.recordTransition(
        tx,
        actor,
        inserted.rows[0].id,
        'CREATED',
        'CREATED',
        'batch opened',
      );
      await writeAudit(tx, {
        actorType: actor.actorType === 'SERVICE' ? 'SERVICE' : 'USER',
        actorId: actor.id,
        action: 'settlement.created',
        resourceType: 'settlement',
        resourceId: inserted.rows[0].id,
        afterState: {
          merchantId: input.merchantId,
          settlementDate: input.settlementDate,
          currency: input.currency,
          itemCount: input.items.length,
        },
        reason: 'batch opened',
      });
      return this.toView(inserted.rows[0], null);
    });
  }

  async list(actor: Principal, page: { limit: number; offset: number }): Promise<SettlementView[]> {
    const scoped = actor.merchantId;
    const result =
      scoped === undefined
        ? await this.database.query<BatchRow>(
            `SELECT ${BATCH_COLUMNS} FROM settlement_batches
             ORDER BY settlement_date DESC, id DESC
             LIMIT $1 OFFSET $2`,
            [page.limit, page.offset],
          )
        : await this.database.query<BatchRow>(
            `SELECT ${BATCH_COLUMNS} FROM settlement_batches
             WHERE merchant_id = $1
             ORDER BY settlement_date DESC, id DESC
             LIMIT $2 OFFSET $3`,
            [scoped, page.limit, page.offset],
          );
    return Promise.all(result.rows.map((row) => this.withDigest(row)));
  }

  async get(actor: Principal, batchId: string): Promise<SettlementView> {
    const batch = await this.find(this.database, batchId);
    this.assertMerchant(actor, batch.merchant_id);
    return this.withDigest(batch);
  }

  async calculate(actor: Principal, batchId: string): Promise<SettlementView> {
    return this.database.withTransaction(async (tx) => {
      const batch = await this.lock(tx, batchId);
      assertSettlementTransition(batch.status, 'CALCULATING');
      await this.transition(tx, actor, batch, 'CALCULATING', 'calculation started');

      const items = await this.loadItems(tx, batchId);
      const fee: FeeSchedule = {
        version: batch.fee_schedule_version,
        basisPoints: BigInt(batch.fee_basis_points),
        fixedMinor: BigInt(batch.fixed_fee_minor),
      };
      const totals = calculateSettlement(items, fee, batch.currency.trim());
      const digest = settlementDigest(items, fee, batch.currency.trim());

      await tx.query(
        `UPDATE settlement_batches
         SET gross_minor = $2, fees_minor = $3, refunds_minor = $4,
             chargebacks_minor = $5, adjustments_minor = $6, net_minor = $7
         WHERE id = $1`,
        [
          batchId,
          totals.gross.toString(),
          totals.fees.toString(),
          totals.refunds.toString(),
          totals.chargebacks.toString(),
          totals.adjustments.toString(),
          totals.net.toString(),
        ],
      );
      await tx.query(
        `INSERT INTO settlement_snapshots (
           batch_id, fee_schedule_version, fee_basis_points, fixed_fee_minor, input_digest, totals
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [
          batchId,
          fee.version,
          fee.basisPoints.toString(),
          fee.fixedMinor.toString(),
          digest,
          JSON.stringify(serializeTotals(totals)),
        ],
      );
      const calculating = await this.lock(tx, batchId);
      await this.transition(tx, actor, calculating, 'CALCULATED', 'calculation frozen');
      this.logger.info(
        { event: 'settlement.calculated', settlementId: batchId, netMinor: totals.net.toString() },
        'settlement calculated',
      );
      const updated = await this.find(tx, batchId);
      return this.toView(updated, digest);
    });
  }

  async approve(
    actor: Principal,
    batchId: string,
    availablePayableMinor: bigint,
    reason: string,
  ): Promise<SettlementView> {
    return this.change(actor, batchId, 'APPROVED', reason, (batch) => {
      if (batch.net_minor === null) {
        throw new BusinessConflictError(
          ErrorCode.INVALID_SETTLEMENT_STATE_TRANSITION,
          'Settlement has no totals.',
        );
      }
      assertWithinPayable(BigInt(batch.net_minor), availablePayableMinor);
    });
  }

  async submit(actor: Principal, batchId: string, reason: string): Promise<SettlementView> {
    return this.change(actor, batchId, 'SUBMITTED', reason);
  }

  async confirm(actor: Principal, batchId: string, reason: string): Promise<SettlementView> {
    return this.change(actor, batchId, 'CONFIRMED', reason);
  }

  async markUnknown(actor: Principal, batchId: string, reason: string): Promise<SettlementView> {
    return this.change(actor, batchId, 'SETTLEMENT_UNKNOWN', reason);
  }

  async fail(actor: Principal, batchId: string, reason: string): Promise<SettlementView> {
    return this.change(actor, batchId, 'FAILED', reason);
  }

  async reverse(actor: Principal, batchId: string, reason: string): Promise<SettlementView> {
    return this.change(actor, batchId, 'REVERSED', reason);
  }

  async reproduce(batchId: string): Promise<{ digest: string; matches: boolean }> {
    const batch = await this.find(this.database, batchId);
    const items = await this.loadItems(this.database, batchId);
    const fee: FeeSchedule = {
      version: batch.fee_schedule_version,
      basisPoints: BigInt(batch.fee_basis_points),
      fixedMinor: BigInt(batch.fixed_fee_minor),
    };
    const totals = calculateSettlement(items, fee, batch.currency.trim());
    const digest = settlementDigest(items, fee, batch.currency.trim());
    const stored = await this.database.query<{
      input_digest: string;
      totals: SettlementTotalsJson;
    }>('SELECT input_digest, totals FROM settlement_snapshots WHERE batch_id = $1', [batchId]);
    const snapshot = stored.rows[0];
    const matches =
      snapshot !== undefined &&
      snapshot.input_digest === digest &&
      snapshot.totals.net === totals.net.toString() &&
      snapshot.totals.gross === totals.gross.toString() &&
      snapshot.totals.fees === totals.fees.toString();
    return { digest, matches };
  }

  private async change(
    actor: Principal,
    batchId: string,
    to: SettlementStatus,
    reason: string,
    guard?: (batch: BatchRow) => void,
  ): Promise<SettlementView> {
    return this.database.withTransaction(async (tx) => {
      const batch = await this.lock(tx, batchId);
      assertSettlementTransition(batch.status, to);
      guard?.(batch);
      await this.transition(tx, actor, batch, to, reason);
      const updated = await this.find(tx, batchId);
      const snapshot = await tx.query<{ input_digest: string }>(
        'SELECT input_digest FROM settlement_snapshots WHERE batch_id = $1',
        [batchId],
      );
      return this.toView(updated, snapshot.rows[0]?.input_digest ?? null);
    });
  }

  private async transition(
    tx: Executor,
    actor: Principal,
    batch: BatchRow,
    to: SettlementStatus,
    reason: string,
  ): Promise<void> {
    await tx.query(
      `UPDATE settlement_batches SET status = $2, version = version + 1 WHERE id = $1 AND version = $3`,
      [batch.id, to, batch.version],
    );
    await this.recordTransition(tx, actor, batch.id, batch.status, to, reason);
    await writeAudit(tx, {
      actorType: actor.actorType === 'SERVICE' ? 'SERVICE' : 'USER',
      actorId: actor.id,
      action: `settlement.${to.toLowerCase()}`,
      resourceType: 'settlement',
      resourceId: batch.id,
      beforeState: { status: batch.status },
      afterState: { status: to },
      reason,
    });
  }

  private async recordTransition(
    tx: Executor,
    actor: Principal,
    batchId: string,
    from: string,
    to: string,
    reason: string,
  ): Promise<void> {
    await tx.query(
      `INSERT INTO settlement_transitions (batch_id, previous_status, new_status, actor_id, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [batchId, from, to, actor.id, reason],
    );
  }

  private async lock(tx: Executor, id: string): Promise<BatchRow> {
    const result = await tx.query<BatchRow>(
      `SELECT ${BATCH_COLUMNS} FROM settlement_batches WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const row = result.rows[0];
    if (row === undefined)
      throw new NotFoundError(ErrorCode.SETTLEMENT_NOT_FOUND, 'Settlement not found.');
    return row;
  }

  private assertMerchant(actor: Principal, merchantId: string): void {
    if (actor.merchantId !== undefined && actor.merchantId !== merchantId) {
      throw new ForbiddenError('This settlement belongs to another merchant.');
    }
  }

  private async withDigest(batch: BatchRow): Promise<SettlementView> {
    const snapshot = await this.database.query<{ input_digest: string }>(
      'SELECT input_digest FROM settlement_snapshots WHERE batch_id = $1',
      [batch.id],
    );
    return this.toView(batch, snapshot.rows[0]?.input_digest ?? null);
  }

  private async find(tx: Executor, id: string): Promise<BatchRow> {
    const result = await tx.query<BatchRow>(
      `SELECT ${BATCH_COLUMNS} FROM settlement_batches WHERE id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (row === undefined)
      throw new NotFoundError(ErrorCode.SETTLEMENT_NOT_FOUND, 'Settlement not found.');
    return row;
  }

  private async loadItems(tx: Executor, batchId: string): Promise<SettlementItem[]> {
    const result = await tx.query<{
      item_type: SettlementItem['itemType'];
      source_id: string;
      amount_minor: string;
      currency: string;
    }>(
      'SELECT item_type, source_id, amount_minor, currency FROM settlement_items WHERE batch_id = $1',
      [batchId],
    );
    return result.rows.map((row) => ({
      itemType: row.item_type,
      sourceId: row.source_id,
      amountMinor: BigInt(row.amount_minor),
      currency: row.currency.trim(),
    }));
  }

  private toView(batch: BatchRow, digest: string | null): SettlementView {
    const date =
      batch.settlement_date instanceof Date
        ? batch.settlement_date.toISOString().slice(0, 10)
        : String(batch.settlement_date).slice(0, 10);
    return {
      id: batch.id,
      merchantId: batch.merchant_id,
      settlementDate: date,
      currency: batch.currency.trim(),
      status: batch.status,
      digest,
      totals:
        batch.net_minor === null
          ? null
          : {
              gross: batch.gross_minor ?? '0',
              fees: batch.fees_minor ?? '0',
              refunds: batch.refunds_minor ?? '0',
              chargebacks: batch.chargebacks_minor ?? '0',
              adjustments: batch.adjustments_minor ?? '0',
              net: batch.net_minor,
            },
    };
  }
}

interface SettlementTotalsJson {
  gross: string;
  fees: string;
  refunds: string;
  chargebacks: string;
  adjustments: string;
  net: string;
}

function serializeTotals(totals: SettlementTotals): SettlementTotalsJson {
  return {
    gross: totals.gross.toString(),
    fees: totals.fees.toString(),
    refunds: totals.refunds.toString(),
    chargebacks: totals.chargebacks.toString(),
    adjustments: totals.adjustments.toString(),
    net: totals.net.toString(),
  };
}

const BATCH_COLUMNS = `id, merchant_id, settlement_date, currency, status, fee_schedule_version,
  fee_basis_points, fixed_fee_minor, gross_minor, fees_minor, refunds_minor, chargebacks_minor,
  adjustments_minor, net_minor, version`;
