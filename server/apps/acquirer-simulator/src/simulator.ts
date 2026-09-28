import { createHash } from 'node:crypto';

/**
 * Deterministic stand-in for an external acquirer.
 *
 * The simulator remembers every attempt it actually processed. A lost HTTP response
 * therefore does not lose the provider-side result: status lookup by attempt id returns
 * it, which is what makes AUTHORIZATION_UNKNOWN recoverable without a second charge.
 */
export const ACQUIRER_MODES = [
  'SUCCESS',
  'TIMEOUT',
  'TRANSIENT_FAILURE',
  'PERMANENT_FAILURE',
  'DUPLICATE_RESPONSE',
  'DELAYED_SUCCESS',
  'WRONG_AMOUNT',
  'WRONG_CURRENCY',
  'MISSING_SETTLEMENT',
  'DUPLICATE_SETTLEMENT',
] as const;

export type AcquirerMode = (typeof ACQUIRER_MODES)[number];

export type AcquirerOperation = 'AUTHORIZE' | 'CAPTURE' | 'REFUND';

export interface AcquirerRequest {
  readonly attemptId: string;
  readonly paymentId: string;
  readonly operation: AcquirerOperation;
  readonly amountMinor: bigint;
  readonly currency: string;
}

export type StoredAcquirerResult =
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

export interface SettlementLine {
  readonly paymentId: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly providerReference: string;
}

export class AcquirerSimulator {
  private mode: AcquirerMode;
  private readonly processed = new Map<string, StoredAcquirerResult>();

  constructor(mode: AcquirerMode = 'SUCCESS') {
    this.mode = mode;
  }

  get currentMode(): AcquirerMode {
    return this.mode;
  }

  setMode(mode: AcquirerMode): void {
    this.mode = mode;
  }

  reset(mode: AcquirerMode = 'SUCCESS'): void {
    this.mode = mode;
    this.processed.clear();
  }

  /**
   * Executes an operation.
   *
   * TIMEOUT processes the attempt and then throws, so the caller cannot tell success from
   * failure. Lookup still can. Repeating the same attempt id returns the stored result
   * instead of creating a second provider-side effect.
   */
  async execute(request: AcquirerRequest): Promise<StoredAcquirerResult> {
    const existing = this.processed.get(request.attemptId);
    if (existing !== undefined) {
      return existing;
    }

    if (this.mode === 'DELAYED_SUCCESS') {
      await delay(50);
    }

    const result = this.decide(request);
    const processed = result.outcome === 'DECLINED' && this.mode === 'TRANSIENT_FAILURE' ? null : result;

    // Transient failures are explicit non-processing: nothing is stored, so a later lookup
    // reports the attempt as unknown rather than approved.
    if (processed !== null && this.mode !== 'TRANSIENT_FAILURE') {
      this.processed.set(request.attemptId, result);
    }

    if (this.mode === 'TIMEOUT') {
      throw new ProviderTransportError(request.attemptId);
    }

    if (this.mode === 'TRANSIENT_FAILURE') {
      return {
        outcome: 'DECLINED',
        failureCode: 'TRANSIENT',
        failureReason: 'Acquirer asked the caller to retry later.',
      };
    }

    return result;
  }

  lookup(attemptId: string): StoredAcquirerResult | null {
    return this.processed.get(attemptId) ?? null;
  }

  /**
   * Settlement file the reconciliation job will import. Modes that tamper with the file
   * do not change the authorization result; they change what the statement claims.
   */
  settlementFile(captures: readonly { paymentId: string; amountMinor: bigint; currency: string }[]): SettlementLine[] {
    if (this.mode === 'MISSING_SETTLEMENT') {
      return [];
    }

    const lines = captures.map((capture) => this.settlementLine(capture));
    if (this.mode === 'DUPLICATE_SETTLEMENT') {
      return [...lines, ...lines];
    }
    return lines;
  }

  private decide(request: AcquirerRequest): StoredAcquirerResult {
    if (this.mode === 'PERMANENT_FAILURE') {
      return {
        outcome: 'DECLINED',
        failureCode: 'DO_NOT_HONOR',
        failureReason: 'Acquirer permanently declined the attempt.',
      };
    }

    const amountMinor = this.mode === 'WRONG_AMOUNT' ? request.amountMinor - 1n : request.amountMinor;
    const currency = this.mode === 'WRONG_CURRENCY' ? 'USD' : request.currency;

    return {
      outcome: 'APPROVED',
      providerReference: providerReference(request.attemptId),
      amountMinor,
      currency,
    };
  }

  private settlementLine(capture: { paymentId: string; amountMinor: bigint; currency: string }): SettlementLine {
    return {
      paymentId: capture.paymentId,
      amountMinor: this.mode === 'WRONG_AMOUNT' ? capture.amountMinor - 100n : capture.amountMinor,
      currency: this.mode === 'WRONG_CURRENCY' ? 'USD' : capture.currency,
      providerReference: `stl_${capture.paymentId}`,
    };
  }
}

function providerReference(attemptId: string): string {
  return `prov_${createHash('sha256').update(attemptId).digest('hex').slice(0, 16)}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
