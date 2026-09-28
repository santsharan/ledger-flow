import {
  AppError,
  BusinessConflictError,
  ErrorCode,
  InternalError,
  TransientError,
} from '@ledgerflow/errors';

/** PostgreSQL SQLSTATE codes the platform reacts to specifically. */
export const PgErrorCode = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  NOT_NULL_VIOLATION: '23502',
  CHECK_VIOLATION: '23514',
  EXCLUSION_VIOLATION: '23P01',
  SERIALIZATION_FAILURE: '40001',
  DEADLOCK_DETECTED: '40P01',
  LOCK_NOT_AVAILABLE: '55P03',
  QUERY_CANCELED: '57014',
  ADMIN_SHUTDOWN: '57P01',
  CRASH_SHUTDOWN: '57P02',
  CANNOT_CONNECT_NOW: '57P03',
  TOO_MANY_CONNECTIONS: '53300',
  OUT_OF_MEMORY: '53200',
  DISK_FULL: '53100',
  READ_ONLY_SQL_TRANSACTION: '25006',
  RAISE_EXCEPTION: 'P0001',
} as const;

export interface PostgresError extends Error {
  readonly code?: string;
  readonly constraint?: string;
  readonly table?: string;
  readonly column?: string;
  readonly detail?: string;
}

export function isPostgresError(error: unknown): error is PostgresError {
  return error instanceof Error && typeof (error as PostgresError).code === 'string';
}

/** A transient failure is worth retrying; everything else is not (failure-model.md §2). */
export function isRetryablePgError(error: unknown): boolean {
  // Driver errors may already have been mapped — a deadlock surfaced from inside a transaction
  // callback arrives as a TransientError, not as SQLSTATE 40P01.
  if (AppError.isAppError(error)) {
    return error.category === 'TRANSIENT';
  }

  if (!isPostgresError(error)) {
    return isConnectionError(error);
  }

  switch (error.code) {
    case PgErrorCode.SERIALIZATION_FAILURE:
    case PgErrorCode.DEADLOCK_DETECTED:
    case PgErrorCode.LOCK_NOT_AVAILABLE:
    case PgErrorCode.CANNOT_CONNECT_NOW:
    case PgErrorCode.ADMIN_SHUTDOWN:
    case PgErrorCode.CRASH_SHUTDOWN:
      return true;
    default:
      return isConnectionError(error);
  }
}

export function isConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT') return true;

  return (
    error.message.includes('Connection terminated') ||
    error.message.includes('connection timeout') ||
    error.message.includes('timeout exceeded when trying to connect')
  );
}

export interface ConstraintErrorMapping {
  /** Constraint name as declared in the migration. */
  readonly constraint: string;
  readonly error: () => AppError;
}

/**
 * Translates a driver error into a typed application error.
 *
 * Constraint violations are the platform's financial invariants firing, so callers can map a
 * specific constraint to a specific business error — "this idempotency key already exists"
 * rather than "database error". Anything unrecognised becomes INTERNAL_ERROR so SQL text and
 * table names never reach a client (specification §34).
 */
/**
 * Maps database failures while leaving application errors alone.
 *
 * A domain error thrown from inside a transaction callback must reach the caller unchanged;
 * flattening it into INTERNAL_ERROR would hide the business reason the transaction was aborted.
 */
export function normalizeDatabaseError(
  error: unknown,
  mappings: readonly ConstraintErrorMapping[] = [],
): unknown {
  if (AppError.isAppError(error)) return error;
  if (isPostgresError(error) || isConnectionError(error)) return mapPgError(error, mappings);
  return error;
}

export function mapPgError(
  error: unknown,
  mappings: readonly ConstraintErrorMapping[] = [],
): AppError {
  if (AppError.isAppError(error)) {
    return error;
  }

  if (!isPostgresError(error)) {
    if (isConnectionError(error)) {
      return new TransientError(
        ErrorCode.DATABASE_UNAVAILABLE,
        'The database is temporarily unavailable.',
        error,
      );
    }
    return new InternalError(undefined, error);
  }

  if (error.constraint !== undefined) {
    const mapping = mappings.find((candidate) => candidate.constraint === error.constraint);
    if (mapping !== undefined) {
      return mapping.error();
    }
  }

  switch (error.code) {
    case PgErrorCode.UNIQUE_VIOLATION:
      return new BusinessConflictError(
        ErrorCode.UNIQUE_VIOLATION,
        'The resource already exists.',
        error.constraint === undefined ? {} : { constraint: error.constraint },
      );
    case PgErrorCode.FOREIGN_KEY_VIOLATION:
      return new BusinessConflictError(
        ErrorCode.FOREIGN_KEY_VIOLATION,
        'A referenced resource does not exist.',
        error.constraint === undefined ? {} : { constraint: error.constraint },
      );
    case PgErrorCode.CHECK_VIOLATION:
    case PgErrorCode.NOT_NULL_VIOLATION:
    case PgErrorCode.EXCLUSION_VIOLATION:
      return new BusinessConflictError(
        ErrorCode.CHECK_VIOLATION,
        'The request violates a data integrity rule.',
        error.constraint === undefined ? {} : { constraint: error.constraint },
      );
    case PgErrorCode.SERIALIZATION_FAILURE:
      return new TransientError(
        ErrorCode.SERIALIZATION_FAILURE,
        'The transaction conflicted with a concurrent transaction.',
        error,
      );
    case PgErrorCode.DEADLOCK_DETECTED:
      return new TransientError(
        ErrorCode.DATABASE_DEADLOCK,
        'The transaction was rolled back to resolve a deadlock.',
        error,
      );
    case PgErrorCode.LOCK_NOT_AVAILABLE:
      return new TransientError(
        ErrorCode.DATABASE_TIMEOUT,
        'The required row lock was not available.',
        error,
      );
    case PgErrorCode.QUERY_CANCELED:
      return new TransientError(
        ErrorCode.DATABASE_TIMEOUT,
        'The database statement exceeded its timeout.',
        error,
      );
    case PgErrorCode.TOO_MANY_CONNECTIONS:
    case PgErrorCode.OUT_OF_MEMORY:
    case PgErrorCode.DISK_FULL:
    case PgErrorCode.CANNOT_CONNECT_NOW:
    case PgErrorCode.ADMIN_SHUTDOWN:
    case PgErrorCode.CRASH_SHUTDOWN:
      return new TransientError(
        ErrorCode.DATABASE_UNAVAILABLE,
        'The database is temporarily unavailable.',
        error,
      );
    default:
      return new InternalError(undefined, error);
  }
}
