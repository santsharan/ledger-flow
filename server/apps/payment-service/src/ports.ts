import { BusinessConflictError, ErrorCode, NotFoundError } from '@ledgerflow/errors';
import { signAccessToken } from '@ledgerflow/auth';
import { isInDatabaseTransaction } from '@ledgerflow/database';

export type AcquirerOperation = 'AUTHORIZE' | 'CAPTURE' | 'REFUND';

export interface AcquirerRequest {
  readonly attemptId: string;
  readonly paymentId: string;
  readonly operation: AcquirerOperation;
  readonly amountMinor: bigint;
  readonly currency: string;
}

export type AcquirerResult =
  | {
      readonly outcome: 'APPROVED';
      readonly providerReference: string;
      readonly amountMinor: bigint;
      readonly currency: string;
    }
  | {
      readonly outcome: 'DECLINED';
      readonly failureCode: string;
      readonly failureReason: string;
    };

export class ProviderTransportError extends Error {
  readonly attemptId: string;

  constructor(attemptId: string) {
    super('The provider response was not received.');
    this.name = 'ProviderTransportError';
    this.attemptId = attemptId;
  }
}

export function isProviderTransportError(error: unknown): error is ProviderTransportError {
  return error instanceof Error && error.name === 'ProviderTransportError';
}

export interface AcquirerPort {
  execute(request: AcquirerRequest): Promise<AcquirerResult>;
  lookup(attemptId: string): Promise<AcquirerResult | null>;
}

export interface LedgerPostingRequest {
  readonly merchantId: string;
  readonly referenceType: 'PAYMENT_CAPTURE' | 'PAYMENT_REFUND';
  readonly referenceId: string;
  readonly amountMinor: bigint;
  readonly currency: string;
}

export interface LedgerPort {
  post(request: LedgerPostingRequest): Promise<{ journalId: string }>;
}

export const ACQUIRER = Symbol('ACQUIRER');
export const LEDGER = Symbol('LEDGER');

/**
 * Calls the acquirer simulator over HTTP.
 * A timeout or a network failure becomes ProviderTransportError — never a guessed decline.
 */
export class HttpAcquirerClient implements AcquirerPort {
  constructor(private readonly baseUrl: string) {}

  async execute(request: AcquirerRequest): Promise<AcquirerResult> {
    this.assertOutsideTransaction();
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/acquirer/execute`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          attemptId: request.attemptId,
          paymentId: request.paymentId,
          operation: request.operation,
          amountMinor: request.amountMinor.toString(),
          currency: request.currency,
        }),
        signal: AbortSignal.timeout(3_000),
      });

      if (response.status === 504) {
        throw new ProviderTransportError(request.attemptId);
      }
      if (!response.ok) {
        throw new ProviderTransportError(request.attemptId);
      }
      return parseAcquirerResult(await response.json());
    } catch (error) {
      if (isProviderTransportError(error)) throw error;
      throw new ProviderTransportError(request.attemptId);
    }
  }

  async lookup(attemptId: string): Promise<AcquirerResult | null> {
    this.assertOutsideTransaction();
    const response = await fetch(`${this.baseUrl}/api/v1/acquirer/attempts/${attemptId}`);
    if (response.status === 404) return null;
    if (!response.ok) throw new ProviderTransportError(attemptId);
    return parseAcquirerResult(await response.json());
  }

  private assertOutsideTransaction(): void {
    if (isInDatabaseTransaction()) {
      throw new Error('Acquirer calls must not run inside a database transaction.');
    }
  }
}

/**
 * Posts a balanced capture or refund journal to ledger-service.
 * The ledger reference is the posting reference, so a retry returns the original journal.
 */
export class HttpLedgerClient implements LedgerPort {
  private token: Promise<string> | undefined;

  constructor(
    private readonly baseUrl: string,
    private readonly jwtSecret: string,
  ) {}

  async post(request: LedgerPostingRequest): Promise<{ journalId: string }> {
    if (isInDatabaseTransaction()) {
      throw new Error('Ledger calls must not run inside a database transaction.');
    }

    const token = await this.accessToken();
    const receivable = await this.ensureAccount(token, request, 'MERCHANT_RECEIVABLE', 'ASSET');
    const payable = await this.ensureAccount(token, request, 'MERCHANT_PAYABLE', 'LIABILITY');
    const amount = request.amountMinor.toString();
    const lines =
      request.referenceType === 'PAYMENT_CAPTURE'
        ? [
            { accountId: receivable, direction: 'DEBIT', amountMinor: amount, currency: request.currency },
            { accountId: payable, direction: 'CREDIT', amountMinor: amount, currency: request.currency },
          ]
        : [
            { accountId: payable, direction: 'DEBIT', amountMinor: amount, currency: request.currency },
            { accountId: receivable, direction: 'CREDIT', amountMinor: amount, currency: request.currency },
          ];

    const journal = await this.request<{ id: string }>(token, 'POST', '/api/v1/journals', {
      transactionId: request.referenceId,
      referenceType: request.referenceType,
      referenceId: request.referenceId,
      currency: request.currency,
      description: request.referenceType,
      lines,
    });

    return { journalId: journal.id };
  }

  private async ensureAccount(
    token: string,
    request: LedgerPostingRequest,
    accountCode: string,
    accountType: string,
  ): Promise<string> {
    const query = new URLSearchParams({
      accountCode,
      currency: request.currency,
      merchantId: request.merchantId,
    });

    try {
      const existing = await this.request<{ id: string }>(
        token,
        'GET',
        `/api/v1/accounts/lookup?${query.toString()}`,
      );
      return existing.id;
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }

    const created = await this.request<{ id: string }>(token, 'POST', '/api/v1/accounts', {
      accountCode,
      accountType,
      currency: request.currency,
      merchantId: request.merchantId,
    });
    return created.id;
  }

  private async accessToken(): Promise<string> {
    this.token ??= signAccessToken(
      {
        subject: 'payment-service',
        actorType: 'SERVICE',
        roles: ['SERVICE'],
        permissions: ['ledger.post', 'ledger.read'],
        expiresInSeconds: 60 * 60,
      },
      this.jwtSecret,
    );
    return this.token;
  }

  private async request<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    if (response.status === 404) {
      throw new NotFoundError(ErrorCode.ACCOUNT_NOT_FOUND, 'Ledger resource not found.');
    }
    if (!response.ok) {
      throw new BusinessConflictError(
        ErrorCode.INTERNAL_ERROR,
        'Ledger posting was rejected.',
        { status: response.status },
      );
    }
    return (await response.json()) as T;
  }
}

function parseAcquirerResult(body: unknown): AcquirerResult {
  const value = body as {
    outcome?: string;
    providerReference?: string;
    amountMinor?: string;
    currency?: string;
    failureCode?: string;
    failureReason?: string;
  };

  if (value.outcome === 'APPROVED') {
    return {
      outcome: 'APPROVED',
      providerReference: value.providerReference ?? '',
      amountMinor: BigInt(value.amountMinor ?? '0'),
      currency: value.currency ?? '',
    };
  }

  return {
    outcome: 'DECLINED',
    failureCode: value.failureCode ?? 'DECLINED',
    failureReason: value.failureReason ?? 'Declined.',
  };
}
