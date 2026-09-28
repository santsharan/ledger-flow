import { Injectable } from '@nestjs/common';
import { type Executor } from '@ledgerflow/database';
import { type PaymentStatus } from './domain/payment-state';

export type AttemptOperation = 'AUTHORIZE' | 'CAPTURE' | 'REFUND';
export type AttemptStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';

export interface PaymentRecord {
  readonly id: string;
  readonly merchantId: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly status: PaymentStatus;
  readonly authorizedMinor: bigint;
  readonly capturedMinor: bigint;
  readonly refundedMinor: bigint;
  readonly version: bigint;
  readonly createdAt: Date;
}

export interface AttemptRecord {
  readonly id: string;
  readonly paymentId: string;
  readonly attemptNumber: number;
  readonly operation: AttemptOperation;
  readonly status: AttemptStatus;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly providerReference: string | null;
  readonly failureCode: string | null;
  readonly failureReason: string | null;
}

export interface LedgerPostingRecord {
  readonly id: string;
  readonly paymentId: string;
  readonly referenceType: string;
  readonly referenceId: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly status: 'PENDING' | 'POSTED';
  readonly journalId: string | null;
}

export interface IdempotencyRecord {
  readonly status: 'IN_PROGRESS' | 'COMPLETED';
  readonly requestHash: string;
  readonly responseStatus: number | null;
  readonly responseBody: unknown;
}

@Injectable()
export class PaymentRepository {
  async insertPayment(
    executor: Executor,
    input: { merchantId: string; amountMinor: bigint; currency: string },
  ): Promise<PaymentRecord> {
    const result = await executor.query<PaymentRow>(
      `INSERT INTO payments (merchant_id, amount_minor, currency)
       VALUES ($1, $2, $3)
       RETURNING ${PAYMENT_COLUMNS}`,
      [input.merchantId, input.amountMinor.toString(), input.currency],
    );
    return toPayment(result.rows[0]!);
  }

  async lockPayment(executor: Executor, id: string): Promise<PaymentRecord | null> {
    const result = await executor.query<PaymentRow>(
      `SELECT ${PAYMENT_COLUMNS} FROM payments WHERE id = $1 FOR UPDATE`,
      [id],
    );
    return result.rows[0] === undefined ? null : toPayment(result.rows[0]);
  }

  async findPayment(executor: Executor, id: string): Promise<PaymentRecord | null> {
    const result = await executor.query<PaymentRow>(
      `SELECT ${PAYMENT_COLUMNS} FROM payments WHERE id = $1`,
      [id],
    );
    return result.rows[0] === undefined ? null : toPayment(result.rows[0]);
  }

  async listPayments(
    executor: Executor,
    input: { merchantId?: string; status?: PaymentStatus; limit: number; offset: number },
  ): Promise<PaymentRecord[]> {
    const result = await executor.query<PaymentRow>(
      `SELECT ${PAYMENT_COLUMNS} FROM payments
       WHERE ($1::uuid IS NULL OR merchant_id = $1)
         AND ($2::text IS NULL OR status = $2)
       ORDER BY created_at DESC
       LIMIT $3 OFFSET $4`,
      [input.merchantId ?? null, input.status ?? null, input.limit, input.offset],
    );
    return result.rows.map(toPayment);
  }

  async updatePayment(
    executor: Executor,
    input: {
      id: string;
      version: bigint;
      status: PaymentStatus;
      authorizedMinor: bigint;
      capturedMinor: bigint;
      refundedMinor: bigint;
    },
  ): Promise<PaymentRecord | null> {
    const result = await executor.query<PaymentRow>(
      `UPDATE payments
       SET status = $2, authorized_minor = $3, captured_minor = $4, refunded_minor = $5,
           version = version + 1, updated_at = now()
       WHERE id = $1 AND version = $6
       RETURNING ${PAYMENT_COLUMNS}`,
      [
        input.id,
        input.status,
        input.authorizedMinor.toString(),
        input.capturedMinor.toString(),
        input.refundedMinor.toString(),
        input.version.toString(),
      ],
    );
    return result.rows[0] === undefined ? null : toPayment(result.rows[0]);
  }

  async nextAttemptNumber(executor: Executor, paymentId: string): Promise<number> {
    const result = await executor.query<{ next: number }>(
      `SELECT COALESCE(MAX(attempt_number), 0) + 1 AS next FROM payment_attempts WHERE payment_id = $1`,
      [paymentId],
    );
    return result.rows[0]!.next;
  }

  async insertAttempt(
    executor: Executor,
    input: {
      paymentId: string;
      attemptNumber: number;
      operation: AttemptOperation;
      amountMinor: bigint;
      currency: string;
    },
  ): Promise<AttemptRecord> {
    const result = await executor.query<AttemptRow>(
      `INSERT INTO payment_attempts (payment_id, attempt_number, operation, provider, amount_minor, currency, status)
       VALUES ($1, $2, $3, 'acquirer-simulator', $4, $5, 'PENDING')
       RETURNING ${ATTEMPT_COLUMNS}`,
      [input.paymentId, input.attemptNumber, input.operation, input.amountMinor.toString(), input.currency],
    );
    return toAttempt(result.rows[0]!);
  }

  async findAttempt(executor: Executor, id: string): Promise<AttemptRecord | null> {
    const result = await executor.query<AttemptRow>(
      `SELECT ${ATTEMPT_COLUMNS} FROM payment_attempts WHERE id = $1`,
      [id],
    );
    return result.rows[0] === undefined ? null : toAttempt(result.rows[0]);
  }

  async lockAttempt(executor: Executor, id: string): Promise<AttemptRecord | null> {
    const result = await executor.query<AttemptRow>(
      `SELECT ${ATTEMPT_COLUMNS} FROM payment_attempts WHERE id = $1 FOR UPDATE`,
      [id],
    );
    return result.rows[0] === undefined ? null : toAttempt(result.rows[0]);
  }

  async latestAttempt(executor: Executor, paymentId: string, operation: AttemptOperation): Promise<AttemptRecord | null> {
    const result = await executor.query<AttemptRow>(
      `SELECT ${ATTEMPT_COLUMNS} FROM payment_attempts
       WHERE payment_id = $1 AND operation = $2
       ORDER BY attempt_number DESC LIMIT 1`,
      [paymentId, operation],
    );
    return result.rows[0] === undefined ? null : toAttempt(result.rows[0]);
  }

  async listAttempts(executor: Executor, paymentId: string): Promise<AttemptRecord[]> {
    const result = await executor.query<AttemptRow>(
      `SELECT ${ATTEMPT_COLUMNS} FROM payment_attempts WHERE payment_id = $1 ORDER BY attempt_number`,
      [paymentId],
    );
    return result.rows.map(toAttempt);
  }

  /** Returns false when the attempt was already completed. The caller must not apply money again. */
  async completeAttempt(
    executor: Executor,
    input: {
      id: string;
      status: AttemptStatus;
      providerReference: string | null;
      failureCode: string | null;
      failureReason: string | null;
    },
  ): Promise<boolean> {
    const result = await executor.query(
      `UPDATE payment_attempts
       SET status = $2, provider_reference = $3, failure_code = $4, failure_reason = $5, completed_at = now()
       WHERE id = $1 AND status IN ('PENDING', 'UNKNOWN')`,
      [input.id, input.status, input.providerReference, input.failureCode, input.failureReason],
    );
    return result.rowCount === 1;
  }

  async insertPosting(
    executor: Executor,
    input: {
      paymentId: string;
      attemptId: string;
      referenceType: string;
      referenceId: string;
      amountMinor: bigint;
      currency: string;
    },
  ): Promise<void> {
    await executor.query(
      `INSERT INTO ledger_postings (payment_id, attempt_id, reference_type, reference_id, amount_minor, currency, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')`,
      [
        input.paymentId,
        input.attemptId,
        input.referenceType,
        input.referenceId,
        input.amountMinor.toString(),
        input.currency,
      ],
    );
  }

  async listPostings(executor: Executor, paymentId: string): Promise<LedgerPostingRecord[]> {
    const result = await executor.query<PostingRow>(
      `SELECT id, payment_id, reference_type, reference_id, amount_minor, currency, status, journal_id
       FROM ledger_postings WHERE payment_id = $1 ORDER BY created_at`,
      [paymentId],
    );
    return result.rows.map(toPosting);
  }

  async pendingPostings(executor: Executor, paymentId: string): Promise<LedgerPostingRecord[]> {
    const result = await executor.query<PostingRow>(
      `SELECT id, payment_id, reference_type, reference_id, amount_minor, currency, status, journal_id
       FROM ledger_postings WHERE payment_id = $1 AND status = 'PENDING' ORDER BY created_at
       FOR UPDATE`,
      [paymentId],
    );
    return result.rows.map(toPosting);
  }

  async markPostingPosted(executor: Executor, id: string, journalId: string): Promise<void> {
    await executor.query(
      `UPDATE ledger_postings SET status = 'POSTED', journal_id = $2, posted_at = now()
       WHERE id = $1 AND status = 'PENDING'`,
      [id, journalId],
    );
  }

  async insertIdempotency(
    executor: Executor,
    input: { scope: string; key: string; operation: string; requestHash: string; expiresAt: Date },
  ): Promise<boolean> {
    const result = await executor.query(
      `INSERT INTO idempotency_keys (scope, idempotency_key, operation, request_hash, status, expires_at)
       VALUES ($1, $2, $3, $4, 'IN_PROGRESS', $5)
       ON CONFLICT (scope, idempotency_key) DO NOTHING`,
      [input.scope, input.key, input.operation, input.requestHash, input.expiresAt],
    );
    return result.rowCount === 1;
  }

  async lockIdempotency(executor: Executor, scope: string, key: string): Promise<IdempotencyRecord | null> {
    const result = await executor.query<{
      status: 'IN_PROGRESS' | 'COMPLETED';
      request_hash: string;
      response_status: number | null;
      response_body: unknown;
    }>(
      `SELECT status, request_hash, response_status, response_body
       FROM idempotency_keys WHERE scope = $1 AND idempotency_key = $2 FOR UPDATE`,
      [scope, key],
    );
    const row = result.rows[0];
    if (row === undefined) return null;
    return {
      status: row.status,
      requestHash: row.request_hash,
      responseStatus: row.response_status,
      responseBody: row.response_body,
    };
  }

  async completeIdempotency(
    executor: Executor,
    input: { scope: string; key: string; responseStatus: number; responseBody: unknown },
  ): Promise<void> {
    await executor.query(
      `UPDATE idempotency_keys
       SET status = 'COMPLETED', response_status = $3, response_body = $4::jsonb
       WHERE scope = $1 AND idempotency_key = $2`,
      [input.scope, input.key, input.responseStatus, JSON.stringify(input.responseBody)],
    );
  }
}

const PAYMENT_COLUMNS = `id, merchant_id, amount_minor, currency, status, authorized_minor,
  captured_minor, refunded_minor, version, created_at`;
const ATTEMPT_COLUMNS = `id, payment_id, attempt_number, operation, status, amount_minor, currency,
  provider_reference, failure_code, failure_reason`;

interface PaymentRow {
  id: string;
  merchant_id: string;
  amount_minor: string;
  currency: string;
  status: PaymentStatus;
  authorized_minor: string;
  captured_minor: string;
  refunded_minor: string;
  version: string;
  created_at: Date;
}

interface AttemptRow {
  id: string;
  payment_id: string;
  attempt_number: number;
  operation: AttemptOperation;
  status: AttemptStatus;
  amount_minor: string;
  currency: string;
  provider_reference: string | null;
  failure_code: string | null;
  failure_reason: string | null;
}

interface PostingRow {
  id: string;
  payment_id: string;
  reference_type: string;
  reference_id: string;
  amount_minor: string;
  currency: string;
  status: 'PENDING' | 'POSTED';
  journal_id: string | null;
}

function toPayment(row: PaymentRow): PaymentRecord {
  return {
    id: row.id,
    merchantId: row.merchant_id,
    amountMinor: BigInt(row.amount_minor),
    currency: row.currency.trim(),
    status: row.status,
    authorizedMinor: BigInt(row.authorized_minor),
    capturedMinor: BigInt(row.captured_minor),
    refundedMinor: BigInt(row.refunded_minor),
    version: BigInt(row.version),
    createdAt: row.created_at,
  };
}

function toAttempt(row: AttemptRow): AttemptRecord {
  return {
    id: row.id,
    paymentId: row.payment_id,
    attemptNumber: row.attempt_number,
    operation: row.operation,
    status: row.status,
    amountMinor: BigInt(row.amount_minor),
    currency: row.currency.trim(),
    providerReference: row.provider_reference,
    failureCode: row.failure_code,
    failureReason: row.failure_reason,
  };
}

function toPosting(row: PostingRow): LedgerPostingRecord {
  return {
    id: row.id,
    paymentId: row.payment_id,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    amountMinor: BigInt(row.amount_minor),
    currency: row.currency.trim(),
    status: row.status,
    journalId: row.journal_id,
  };
}
