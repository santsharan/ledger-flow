import { describe, expect, it } from 'vitest';
import {
  AmbiguousOutcomeError,
  AppError,
  BusinessConflictError,
  ErrorCode,
  TransientError,
  toErrorResponse,
} from './index';

describe('AppError', () => {
  it('carries code, status and category', () => {
    const error = new BusinessConflictError(
      ErrorCode.CAPTURE_EXCEEDS_AUTHORIZED,
      'Capture exceeds the authorized amount.',
      { authorizedMinor: '1000', requestedMinor: '1500' },
    );

    expect(error.code).toBe('CAPTURE_EXCEEDS_AUTHORIZED');
    expect(error.httpStatus).toBe(409);
    expect(error.category).toBe('BUSINESS_CONFLICT');
    expect(error.details).toEqual({ authorizedMinor: '1000', requestedMinor: '1500' });
    expect(AppError.isAppError(error)).toBe(true);
  });

  it('marks only transient errors as retryable', () => {
    expect(new TransientError(ErrorCode.DATABASE_UNAVAILABLE, 'db down').isRetryable).toBe(true);
    expect(
      new BusinessConflictError(ErrorCode.PAYMENT_ALREADY_CAPTURED, 'already captured').isRetryable,
    ).toBe(false);
  });

  it('never marks an ambiguous outcome as retryable (ADR-005)', () => {
    const error = new AmbiguousOutcomeError(
      ErrorCode.PAYMENT_OUTCOME_UNKNOWN,
      'Provider outcome is unknown.',
    );

    expect(error.category).toBe('AMBIGUOUS');
    expect(error.isRetryable).toBe(false);
  });
});

describe('toErrorResponse', () => {
  it('maps an AppError to the public envelope', () => {
    const response = toErrorResponse(
      new BusinessConflictError(ErrorCode.PAYMENT_ALREADY_CAPTURED, 'Payment already captured.'),
      'req_123',
    );

    expect(response).toEqual({
      httpStatus: 409,
      body: {
        error: {
          code: 'PAYMENT_ALREADY_CAPTURED',
          message: 'Payment already captured.',
          requestId: 'req_123',
          details: {},
        },
      },
    });
  });

  it('hides unexpected errors behind INTERNAL_ERROR', () => {
    const response = toErrorResponse(
      new Error('duplicate key value violates unique constraint "payments_pkey"'),
      'req_456',
    );

    expect(response.httpStatus).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(response.body.error.message).not.toContain('unique constraint');
  });

  it('hides non-error throws', () => {
    const response = toErrorResponse('something odd', 'req_789');

    expect(response.httpStatus).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
  });
});
