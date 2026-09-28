import { Inject, Injectable } from '@nestjs/common';
import { writeAudit } from '@ledgerflow/audit';
import { type Principal } from '@ledgerflow/auth';
import { Database } from '@ledgerflow/database';
import {
  BusinessConflictError,
  ErrorCode,
  ForbiddenError,
  InternalError,
  NotFoundError,
} from '@ledgerflow/errors';
import { type Logger } from '@ledgerflow/logger';
import { EventType, createEnvelope } from '@ledgerflow/events';
import { appendOutbox } from '@ledgerflow/messaging';
import { getCurrency } from '@ledgerflow/money';
import { MetricName, increment } from '@ledgerflow/observability';
import { getRequestContext, LOGGER } from '@ledgerflow/service-core';
import {
  assertCaptureAmount,
  assertRefundAmount,
  assertTransition,
  isResolvable,
  statusAfterRefund,
  type PaymentStatus,
} from './domain/payment-state';
import { requestHash } from './domain/request-hash';
import {
  PaymentRepository,
  type AttemptOperation,
  type AttemptRecord,
  type PaymentRecord,
} from './payment.repository';
import {
  ACQUIRER,
  isProviderTransportError,
  LEDGER,
  type AcquirerResult,
  type AcquirerPort,
  type LedgerPort,
} from './ports';

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export interface PaymentSummary {
  readonly id: string;
  readonly merchantId: string;
  readonly status: PaymentStatus;
  readonly currency: string;
  readonly amountMinor: string;
  readonly authorizedMinor: string;
  readonly capturedMinor: string;
  readonly refundedMinor: string;
  readonly createdAt: string;
}

export interface PaymentView {
  readonly id: string;
  readonly merchantId: string;
  readonly status: PaymentStatus;
  readonly currency: string;
  readonly amountMinor: string;
  readonly authorizedMinor: string;
  readonly capturedMinor: string;
  readonly refundedMinor: string;
  readonly attempts: readonly {
    readonly id: string;
    readonly attemptNumber: number;
    readonly operation: string;
    readonly status: string;
    readonly amountMinor: string;
    readonly currency: string;
    readonly providerReference: string | null;
    readonly failureCode: string | null;
  }[];
  readonly ledgerPostings: readonly {
    readonly referenceType: string;
    readonly referenceId: string;
    readonly amountMinor: string;
    readonly status: string;
    readonly journalId: string | null;
  }[];
}

type IdempotencyGate =
  | { readonly kind: 'REPLAY'; readonly body: PaymentView }
  | { readonly kind: 'START'; readonly attempt: AttemptRecord };

@Injectable()
export class PaymentService {
  constructor(
    private readonly database: Database,
    private readonly payments: PaymentRepository,
    @Inject(ACQUIRER) private readonly acquirer: AcquirerPort,
    @Inject(LEDGER) private readonly ledger: LedgerPort,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async create(
    actor: Principal,
    idempotencyKey: string,
    body: { merchantId: string; amountMinor: string; currency: string },
  ): Promise<PaymentView> {
    getCurrency(body.currency);
    const merchantId = this.merchantFor(actor, body.merchantId);
    const amountMinor = BigInt(body.amountMinor);
    const hash = requestHash({
      merchantId,
      amountMinor: body.amountMinor,
      currency: body.currency,
    });

    const created = await this.database.withTransaction(async (tx) => {
      const reserved = await this.payments.insertIdempotency(tx, {
        scope: merchantId,
        key: idempotencyKey,
        operation: 'CREATE',
        requestHash: hash,
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      });

      if (!reserved) {
        return {
          replay: await this.existingIdempotentResponse(tx, merchantId, idempotencyKey, hash),
        };
      }

      const payment = await this.payments.insertPayment(tx, {
        merchantId,
        amountMinor,
        currency: body.currency,
      });
      const view = await this.view(tx, payment.id);
      await this.payments.completeIdempotency(tx, {
        scope: merchantId,
        key: idempotencyKey,
        responseStatus: 201,
        responseBody: view,
      });
      await writeAudit(tx, {
        ...actorOf(actor),
        action: 'payment.created',
        resourceType: 'payment',
        resourceId: payment.id,
        afterState: { status: 'CREATED', amountMinor: body.amountMinor, currency: body.currency },
        ...correlation(),
      });
      return { view };
    });

    if ('replay' in created) return created.replay;
    increment(MetricName.paymentsCreated);
    return created.view;
  }

  async get(actor: Principal, paymentId: string): Promise<PaymentView> {
    const payment = await this.payments.findPayment(this.database, paymentId);
    if (payment === null)
      throw new NotFoundError(ErrorCode.PAYMENT_NOT_FOUND, 'Payment not found.');
    this.assertAccess(actor, payment);
    return this.view(this.database, payment.id);
  }

  async list(
    actor: Principal,
    query: { status?: PaymentStatus; limit: number; offset: number },
  ): Promise<PaymentSummary[]> {
    const rows = await this.payments.listPayments(this.database, {
      ...(actor.merchantId === undefined ? {} : { merchantId: actor.merchantId }),
      ...(query.status === undefined ? {} : { status: query.status }),
      limit: query.limit,
      offset: query.offset,
    });
    return rows.map((payment) => ({
      id: payment.id,
      merchantId: payment.merchantId,
      status: payment.status,
      currency: payment.currency,
      amountMinor: payment.amountMinor.toString(),
      authorizedMinor: payment.authorizedMinor.toString(),
      capturedMinor: payment.capturedMinor.toString(),
      refundedMinor: payment.refundedMinor.toString(),
      createdAt: payment.createdAt.toISOString(),
    }));
  }

  async authorize(
    actor: Principal,
    paymentId: string,
    idempotencyKey: string,
  ): Promise<PaymentView> {
    const payment = await this.requirePayment(actor, paymentId);
    const gate = await this.beginProviderOperation({
      actor,
      payment,
      idempotencyKey,
      operation: 'AUTHORIZE',
      pendingStatus: 'AUTHORIZATION_PENDING',
      amountMinor: payment.amountMinor,
      hash: requestHash({ paymentId, operation: 'AUTHORIZE' }),
    });
    if (gate.kind === 'REPLAY') return gate.body;
    await this.callProviderAndApply(payment, gate.attempt);
    return this.finish(payment.merchantId, idempotencyKey, payment.id);
  }

  async capture(
    actor: Principal,
    paymentId: string,
    idempotencyKey: string,
    amountMinor: bigint | undefined,
  ): Promise<PaymentView> {
    const payment = await this.requirePayment(actor, paymentId);
    const requested = amountMinor ?? payment.authorizedMinor;
    assertCaptureAmount(payment.authorizedMinor, requested);

    const gate = await this.beginProviderOperation({
      actor,
      payment,
      idempotencyKey,
      operation: 'CAPTURE',
      pendingStatus: 'CAPTURE_PENDING',
      amountMinor: requested,
      hash: requestHash({ paymentId, operation: 'CAPTURE', amountMinor: requested.toString() }),
    });
    if (gate.kind === 'REPLAY') return gate.body;

    await this.callProviderAndApply(payment, gate.attempt);
    await this.flushLedger(payment.id, payment.merchantId);
    return this.finish(payment.merchantId, idempotencyKey, payment.id);
  }

  async refund(
    actor: Principal,
    paymentId: string,
    idempotencyKey: string,
    amountMinor: bigint | undefined,
  ): Promise<PaymentView> {
    const payment = await this.requirePayment(actor, paymentId);
    const requested = amountMinor ?? payment.capturedMinor - payment.refundedMinor;
    assertRefundAmount(payment.capturedMinor, payment.refundedMinor, requested);

    const gate = await this.beginProviderOperation({
      actor,
      payment,
      idempotencyKey,
      operation: 'REFUND',
      pendingStatus: 'REFUND_PENDING',
      amountMinor: requested,
      hash: requestHash({ paymentId, operation: 'REFUND', amountMinor: requested.toString() }),
    });
    if (gate.kind === 'REPLAY') return gate.body;

    await this.callProviderAndApply(payment, gate.attempt);
    await this.flushLedger(payment.id, payment.merchantId);
    return this.finish(payment.merchantId, idempotencyKey, payment.id);
  }

  /**
   * Resolves AUTHORIZATION_UNKNOWN / CAPTURE_UNKNOWN / REFUND_UNKNOWN, and a pending attempt
   * whose worker died, by asking the provider what happened. This never sends a second charge.
   */
  async resolve(actor: Principal, paymentId: string): Promise<PaymentView> {
    const current = await this.requirePayment(actor, paymentId);
    if (!isResolvable(current.status)) {
      throw new BusinessConflictError(
        ErrorCode.INVALID_PAYMENT_STATE_TRANSITION,
        `Payment in ${current.status} does not need resolution.`,
        { status: current.status },
      );
    }

    const operation = operationForStatus(current.status);
    const attempt = await this.payments.latestAttempt(this.database, paymentId, operation);
    if (attempt === null) {
      throw new InternalError('Resolvable payment has no provider attempt.');
    }

    const lookedUp = await this.acquirer.lookup(attempt.id);
    await this.database.withTransaction(async (tx) => {
      await this.applyResult(tx, actor, attempt.id, lookedUp ?? 'NOT_FOUND');
    });
    await this.flushLedger(paymentId, current.merchantId);
    return this.view(this.database, paymentId);
  }

  async postPendingLedger(actor: Principal, paymentId: string): Promise<PaymentView> {
    const payment = await this.requirePayment(actor, paymentId);
    await this.flushLedger(payment.id, payment.merchantId);
    return this.view(this.database, payment.id);
  }

  /**
   * Applies a provider result that has already been seen. A second delivery does not move money.
   */
  async redeliverProviderResult(attemptId: string, result: AcquirerResult): Promise<PaymentView> {
    const attempt = await this.payments.findAttempt(this.database, attemptId);
    if (attempt === null)
      throw new NotFoundError(ErrorCode.NOT_FOUND, 'Payment attempt not found.');

    await this.database.withTransaction(async (tx) => {
      await this.applyResult(tx, systemActor(), attemptId, result);
    });
    return this.view(this.database, attempt.paymentId);
  }

  private async beginProviderOperation(input: {
    actor: Principal;
    payment: PaymentRecord;
    idempotencyKey: string;
    operation: AttemptOperation;
    pendingStatus: PaymentStatus;
    amountMinor: bigint;
    hash: string;
  }): Promise<IdempotencyGate> {
    return this.database.withTransaction(async (tx) => {
      const reserved = await this.payments.insertIdempotency(tx, {
        scope: input.payment.merchantId,
        key: input.idempotencyKey,
        operation: input.operation,
        requestHash: input.hash,
        expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
      });

      if (!reserved) {
        return {
          kind: 'REPLAY',
          body: await this.existingIdempotentResponse(
            tx,
            input.payment.merchantId,
            input.idempotencyKey,
            input.hash,
          ),
        };
      }

      const payment = await this.payments.lockPayment(tx, input.payment.id);
      if (payment === null)
        throw new NotFoundError(ErrorCode.PAYMENT_NOT_FOUND, 'Payment not found.');
      assertTransition(payment.status, input.pendingStatus);

      const attempt = await this.payments.insertAttempt(tx, {
        paymentId: payment.id,
        attemptNumber: await this.payments.nextAttemptNumber(tx, payment.id),
        operation: input.operation,
        amountMinor: input.amountMinor,
        currency: payment.currency,
      });

      const updated = await this.payments.updatePayment(tx, {
        id: payment.id,
        version: payment.version,
        status: input.pendingStatus,
        authorizedMinor: payment.authorizedMinor,
        capturedMinor: payment.capturedMinor,
        refundedMinor: payment.refundedMinor,
      });
      if (updated === null)
        throw new InternalError('Payment version changed during attempt creation.');

      return { kind: 'START', attempt };
    });
  }

  /**
   * The provider call sits between two committed transactions. The database lock is not held
   * while the acquirer is on the network (specification §41, ADR-005).
   */
  private async finish(
    merchantId: string,
    idempotencyKey: string,
    paymentId: string,
  ): Promise<PaymentView> {
    const view = await this.view(this.database, paymentId);
    await this.database.withTransaction(async (tx) => {
      await this.payments.completeIdempotency(tx, {
        scope: merchantId,
        key: idempotencyKey,
        responseStatus: 200,
        responseBody: view,
      });
    });
    return view;
  }

  private async callProviderAndApply(
    payment: PaymentRecord,
    attempt: AttemptRecord,
  ): Promise<void> {
    let result: AcquirerResult | 'UNKNOWN';
    try {
      result = await this.acquirer.execute({
        attemptId: attempt.id,
        paymentId: payment.id,
        operation: attempt.operation,
        amountMinor: attempt.amountMinor,
        currency: attempt.currency,
      });
    } catch (error) {
      if (!isProviderTransportError(error)) throw error;
      result = 'UNKNOWN';
      this.logger.warn(
        {
          event: 'payment.provider.unknown',
          paymentId: payment.id,
          attemptId: attempt.id,
          operation: attempt.operation,
        },
        'provider outcome is unknown',
      );
    }

    await this.database.withTransaction(async (tx) => {
      await this.applyResult(tx, systemActor(), attempt.id, result);
    });
  }

  private async applyResult(
    tx: Parameters<typeof writeAudit>[0],
    actor: Principal,
    attemptId: string,
    result: AcquirerResult | 'UNKNOWN' | 'NOT_FOUND',
  ): Promise<void> {
    const attempt = await this.payments.lockAttempt(tx, attemptId);
    if (attempt === null)
      throw new NotFoundError(ErrorCode.NOT_FOUND, 'Payment attempt not found.');
    const payment = await this.payments.lockPayment(tx, attempt.paymentId);
    if (payment === null)
      throw new NotFoundError(ErrorCode.PAYMENT_NOT_FOUND, 'Payment not found.');

    if (result === 'NOT_FOUND') {
      return;
    }

    if (result === 'UNKNOWN') {
      const changed = await this.payments.completeAttempt(tx, {
        id: attempt.id,
        status: 'UNKNOWN',
        providerReference: null,
        failureCode: 'PROVIDER_TIMEOUT',
        failureReason: 'The provider outcome could not be determined.',
      });
      if (!changed) return;
      await this.transition(
        tx,
        actor,
        payment,
        unknownStatus(attempt.operation),
        payment.authorizedMinor,
        payment.capturedMinor,
        payment.refundedMinor,
      );
      return;
    }

    if (
      result.outcome === 'DECLINED' ||
      result.amountMinor !== attempt.amountMinor ||
      result.currency !== attempt.currency
    ) {
      const changed = await this.payments.completeAttempt(tx, {
        id: attempt.id,
        status: 'FAILED',
        providerReference: null,
        failureCode:
          result.outcome === 'DECLINED' ? result.failureCode : 'PROVIDER_RESPONSE_INVALID',
        failureReason:
          result.outcome === 'DECLINED'
            ? result.failureReason
            : 'Provider amount or currency did not match the attempt.',
      });
      if (!changed) return;
      await this.transition(
        tx,
        actor,
        payment,
        failedStatus(attempt.operation, payment),
        payment.authorizedMinor,
        payment.capturedMinor,
        payment.refundedMinor,
      );
      return;
    }

    const changed = await this.payments.completeAttempt(tx, {
      id: attempt.id,
      status: 'SUCCEEDED',
      providerReference: result.providerReference,
      failureCode: null,
      failureReason: null,
    });
    if (!changed) return;

    if (attempt.operation === 'AUTHORIZE') {
      await this.transition(
        tx,
        actor,
        payment,
        'AUTHORIZED',
        payment.amountMinor,
        payment.capturedMinor,
        payment.refundedMinor,
      );
      await this.enqueue(tx, payment, EventType.PaymentAuthorized, {
        paymentId: payment.id,
        merchantId: payment.merchantId,
        amountMinor: payment.amountMinor.toString(),
        currency: payment.currency,
        attemptId: attempt.id,
        providerReference: result.providerReference,
      });
      return;
    }

    if (attempt.operation === 'CAPTURE') {
      await this.transition(
        tx,
        actor,
        payment,
        'CAPTURED',
        payment.authorizedMinor,
        attempt.amountMinor,
        payment.refundedMinor,
      );
      await this.payments.insertPosting(tx, {
        paymentId: payment.id,
        attemptId: attempt.id,
        referenceType: 'PAYMENT_CAPTURE',
        referenceId: payment.id,
        amountMinor: attempt.amountMinor,
        currency: payment.currency,
      });
      await this.enqueue(tx, payment, EventType.PaymentCaptured, {
        paymentId: payment.id,
        merchantId: payment.merchantId,
        amountMinor: attempt.amountMinor.toString(),
        currency: payment.currency,
        attemptId: attempt.id,
      });
      return;
    }

    const refundedMinor = payment.refundedMinor + attempt.amountMinor;
    await this.transition(
      tx,
      actor,
      payment,
      statusAfterRefund(payment.capturedMinor, payment.refundedMinor, attempt.amountMinor),
      payment.authorizedMinor,
      payment.capturedMinor,
      refundedMinor,
    );
    await this.payments.insertPosting(tx, {
      paymentId: payment.id,
      attemptId: attempt.id,
      referenceType: 'PAYMENT_REFUND',
      referenceId: attempt.id,
      amountMinor: attempt.amountMinor,
      currency: payment.currency,
    });
    await this.enqueue(tx, payment, EventType.PaymentRefunded, {
      paymentId: payment.id,
      merchantId: payment.merchantId,
      amountMinor: attempt.amountMinor.toString(),
      currency: payment.currency,
      attemptId: attempt.id,
      refundedMinor: refundedMinor.toString(),
      fullyRefunded: refundedMinor === payment.capturedMinor,
    });
  }

  /** The event row commits with the payment change. Publication happens afterwards. */
  private async enqueue(
    tx: Parameters<typeof writeAudit>[0],
    payment: PaymentRecord,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const context = getRequestContext();
    await appendOutbox(
      tx,
      createEnvelope({
        eventType,
        eventVersion: 1,
        producer: 'payment-service',
        aggregateType: 'payment',
        aggregateId: payment.id,
        tenantId: payment.merchantId,
        ...(context?.correlationId === undefined ? {} : { correlationId: context.correlationId }),
        payload,
      }),
    );
  }

  private async transition(
    tx: Parameters<typeof writeAudit>[0],
    actor: Principal,
    payment: PaymentRecord,
    status: PaymentStatus,
    authorizedMinor: bigint,
    capturedMinor: bigint,
    refundedMinor: bigint,
  ): Promise<void> {
    assertTransition(payment.status, status);
    const updated = await this.payments.updatePayment(tx, {
      id: payment.id,
      version: payment.version,
      status,
      authorizedMinor,
      capturedMinor,
      refundedMinor,
    });
    if (updated === null) throw new InternalError('Payment version changed during transition.');

    await writeAudit(tx, {
      ...actorOf(actor),
      action: `payment.${status.toLowerCase()}`,
      resourceType: 'payment',
      resourceId: payment.id,
      beforeState: { status: payment.status },
      afterState: {
        status,
        authorizedMinor: authorizedMinor.toString(),
        capturedMinor: capturedMinor.toString(),
        refundedMinor: refundedMinor.toString(),
      },
      ...correlation(),
    });

    this.logger.info(
      {
        event: `payment.${status.toLowerCase()}`,
        paymentId: payment.id,
        merchantId: payment.merchantId,
        from: payment.status,
        to: status,
      },
      'payment state changed',
    );
  }

  private async flushLedger(paymentId: string, merchantId: string): Promise<void> {
    const postings = (await this.payments.listPostings(this.database, paymentId)).filter(
      (posting) => posting.status === 'PENDING',
    );

    for (const posting of postings) {
      try {
        const posted = await this.ledger.post({
          merchantId,
          referenceType: posting.referenceType as 'PAYMENT_CAPTURE' | 'PAYMENT_REFUND',
          referenceId: posting.referenceId,
          amountMinor: posting.amountMinor,
          currency: posting.currency,
        });
        await this.database.withTransaction(async (tx) => {
          await this.payments.markPostingPosted(tx, posting.id, posted.journalId);
        });
      } catch (error) {
        this.logger.error(
          {
            event: 'payment.ledger_posting.pending',
            paymentId,
            referenceId: posting.referenceId,
            err: error,
          },
          'ledger posting left pending',
        );
      }
    }
  }

  private async existingIdempotentResponse(
    tx: Parameters<typeof writeAudit>[0],
    scope: string,
    key: string,
    hash: string,
  ): Promise<PaymentView> {
    const existing = await this.payments.lockIdempotency(tx, scope, key);
    if (existing === null) throw new InternalError('Idempotency key disappeared.');
    if (existing.requestHash !== hash) {
      throw new BusinessConflictError(
        ErrorCode.IDEMPOTENCY_KEY_CONFLICT,
        'This idempotency key was already used with a different request.',
      );
    }
    if (existing.status !== 'COMPLETED' || existing.responseBody === null) {
      throw new BusinessConflictError(
        ErrorCode.IDEMPOTENT_REQUEST_IN_PROGRESS,
        'A request with this idempotency key is still in progress.',
      );
    }
    return existing.responseBody as PaymentView;
  }

  private async view(
    executor: Parameters<PaymentRepository['findPayment']>[0],
    paymentId: string,
  ): Promise<PaymentView> {
    const payment = await this.payments.findPayment(executor, paymentId);
    if (payment === null)
      throw new NotFoundError(ErrorCode.PAYMENT_NOT_FOUND, 'Payment not found.');
    const [attempts, postings] = await Promise.all([
      this.payments.listAttempts(executor, paymentId),
      this.payments.listPostings(executor, paymentId),
    ]);

    return {
      id: payment.id,
      merchantId: payment.merchantId,
      status: payment.status,
      currency: payment.currency,
      amountMinor: payment.amountMinor.toString(),
      authorizedMinor: payment.authorizedMinor.toString(),
      capturedMinor: payment.capturedMinor.toString(),
      refundedMinor: payment.refundedMinor.toString(),
      attempts: attempts.map((attempt) => ({
        id: attempt.id,
        attemptNumber: attempt.attemptNumber,
        operation: attempt.operation,
        status: attempt.status,
        amountMinor: attempt.amountMinor.toString(),
        currency: attempt.currency,
        providerReference: attempt.providerReference,
        failureCode: attempt.failureCode,
      })),
      ledgerPostings: postings.map((posting) => ({
        referenceType: posting.referenceType,
        referenceId: posting.referenceId,
        amountMinor: posting.amountMinor.toString(),
        status: posting.status,
        journalId: posting.journalId,
      })),
    };
  }

  private async requirePayment(actor: Principal, paymentId: string): Promise<PaymentRecord> {
    const payment = await this.payments.findPayment(this.database, paymentId);
    if (payment === null)
      throw new NotFoundError(ErrorCode.PAYMENT_NOT_FOUND, 'Payment not found.');
    this.assertAccess(actor, payment);
    return payment;
  }

  private merchantFor(actor: Principal, requested: string): string {
    if (actor.merchantId !== undefined && actor.merchantId !== requested) {
      throw new ForbiddenError('This payment belongs to another merchant.');
    }
    return actor.merchantId ?? requested;
  }

  private assertAccess(actor: Principal, payment: PaymentRecord): void {
    if (actor.merchantId !== undefined && actor.merchantId !== payment.merchantId) {
      throw new ForbiddenError('This payment belongs to another merchant.');
    }
  }
}

function unknownStatus(operation: AttemptOperation): PaymentStatus {
  if (operation === 'AUTHORIZE') return 'AUTHORIZATION_UNKNOWN';
  if (operation === 'CAPTURE') return 'CAPTURE_UNKNOWN';
  return 'REFUND_UNKNOWN';
}

function failedStatus(operation: AttemptOperation, payment: PaymentRecord): PaymentStatus {
  if (operation === 'AUTHORIZE') return 'AUTHORIZATION_FAILED';
  if (operation === 'CAPTURE') return 'CAPTURE_FAILED';
  return payment.refundedMinor > 0n ? 'PARTIALLY_REFUNDED' : 'CAPTURED';
}

function operationForStatus(status: PaymentStatus): AttemptOperation {
  if (status.startsWith('AUTHORIZATION') || status === 'CREATED') return 'AUTHORIZE';
  if (status.startsWith('CAPTURE') || status === 'AUTHORIZED') return 'CAPTURE';
  return 'REFUND';
}

function systemActor(): Principal {
  return {
    id: 'payment-service',
    actorType: 'SERVICE',
    roles: ['SERVICE'],
    permissions: [],
    tokenId: 'system',
  };
}

function actorOf(actor: Principal): { actorType: 'USER' | 'SERVICE'; actorId: string } {
  return { actorType: actor.actorType === 'SERVICE' ? 'SERVICE' : 'USER', actorId: actor.id };
}

function correlation(): { requestId: string | null; correlationId: string | null } {
  const context = getRequestContext();
  return { requestId: context?.requestId ?? null, correlationId: context?.correlationId ?? null };
}
