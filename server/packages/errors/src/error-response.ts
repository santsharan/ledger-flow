import { AppError, InternalError } from './app-error';
import { type ErrorCodeValue } from './error-codes';

/** The single error envelope every API returns (specification §34). */
export interface ErrorResponseBody {
  readonly error: {
    readonly code: ErrorCodeValue;
    readonly message: string;
    readonly requestId: string;
    readonly details: Readonly<Record<string, unknown>>;
  };
}

export interface ErrorResponse {
  readonly httpStatus: number;
  readonly body: ErrorResponseBody;
}

/**
 * Converts any thrown value into the public error envelope.
 * Unknown errors are deliberately flattened to INTERNAL_ERROR so database messages and stack
 * traces never reach a client.
 */
export function toErrorResponse(error: unknown, requestId: string): ErrorResponse {
  const appError = AppError.isAppError(error) ? error : new InternalError(undefined, error);

  return {
    httpStatus: appError.httpStatus,
    body: {
      error: {
        code: appError.code,
        message: appError.message,
        requestId,
        details: appError.details,
      },
    },
  };
}
