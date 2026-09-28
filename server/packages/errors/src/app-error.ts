import { ErrorCode, type ErrorCategory, type ErrorCodeValue } from './error-codes';

export interface AppErrorOptions {
  readonly code: ErrorCodeValue;
  readonly message: string;
  readonly httpStatus: number;
  readonly category: ErrorCategory;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

/**
 * Base class for every error the platform raises deliberately.
 *
 * Database exceptions and stack traces are never exposed to clients (specification §34);
 * infrastructure errors are mapped into an AppError before they reach the HTTP layer.
 */
export class AppError extends Error {
  readonly code: ErrorCodeValue;
  readonly httpStatus: number;
  readonly category: ErrorCategory;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(options: AppErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code;
    this.httpStatus = options.httpStatus;
    this.category = options.category;
    this.details = options.details ?? {};
    Error.captureStackTrace?.(this, new.target);
  }

  get isRetryable(): boolean {
    return this.category === 'TRANSIENT';
  }

  static isAppError(error: unknown): error is AppError {
    return error instanceof AppError;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super({
      code: ErrorCode.VALIDATION_FAILED,
      message,
      httpStatus: 400,
      category: 'PERMANENT',
      ...(details === undefined ? {} : { details }),
    });
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication is required.') {
    super({
      code: ErrorCode.UNAUTHENTICATED,
      message,
      httpStatus: 401,
      category: 'PERMANENT',
    });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Permission denied.', details?: Record<string, unknown>) {
    super({
      code: ErrorCode.FORBIDDEN,
      message,
      httpStatus: 403,
      category: 'PERMANENT',
      ...(details === undefined ? {} : { details }),
    });
  }
}

export class NotFoundError extends AppError {
  constructor(code: ErrorCodeValue, message: string, details?: Record<string, unknown>) {
    super({
      code,
      message,
      httpStatus: 404,
      category: 'PERMANENT',
      ...(details === undefined ? {} : { details }),
    });
  }
}

/**
 * A request that is well-formed and authorized but conflicts with current business state —
 * capturing more than was authorized, confirming a settlement twice, reusing an idempotency key
 * with a different body. Deterministic, and never retried automatically.
 */
export class BusinessConflictError extends AppError {
  constructor(code: ErrorCodeValue, message: string, details?: Record<string, unknown>) {
    super({
      code,
      message,
      httpStatus: 409,
      category: 'BUSINESS_CONFLICT',
      ...(details === undefined ? {} : { details }),
    });
  }
}

export class TransientError extends AppError {
  constructor(code: ErrorCodeValue, message: string, cause?: unknown) {
    super({
      code,
      message,
      httpStatus: 503,
      category: 'TRANSIENT',
      ...(cause === undefined ? {} : { cause }),
    });
  }
}

/**
 * The outcome of an external operation could not be determined (ADR-005).
 * Callers must not retry the operation; resolution happens through a status lookup.
 */
export class AmbiguousOutcomeError extends AppError {
  constructor(code: ErrorCodeValue, message: string, details?: Record<string, unknown>) {
    super({
      code,
      message,
      httpStatus: 202,
      category: 'AMBIGUOUS',
      ...(details === undefined ? {} : { details }),
    });
  }
}

export class InternalError extends AppError {
  constructor(message = 'An unexpected error occurred.', cause?: unknown) {
    super({
      code: ErrorCode.INTERNAL_ERROR,
      message,
      httpStatus: 500,
      category: 'PERMANENT',
      ...(cause === undefined ? {} : { cause }),
    });
  }
}
