import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import { AppError, ErrorCode, toErrorResponse, type ErrorResponse } from '@ledgerflow/errors';
import { type Logger } from '@ledgerflow/logger';
import { type FastifyReply } from 'fastify';
import { getRequestContext } from './request-context';

/**
 * Single exit point for errors leaving the HTTP layer.
 *
 * Clients only ever see the error envelope from specification §34; the full error, including
 * cause and stack, goes to the log with the request's correlation identifiers.
 */
@Catch()
export class AppErrorFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const context = getRequestContext();
    const requestId = context?.requestId ?? 'req_unknown';

    const response = this.toResponse(exception, requestId);
    const logPayload = {
      event: 'http.request.failed',
      requestId,
      correlationId: context?.correlationId,
      errorCode: response.body.error.code,
      httpStatus: response.httpStatus,
      err: exception,
    };

    if (response.httpStatus >= 500) {
      this.logger.error(logPayload, response.body.error.message);
    } else {
      this.logger.warn(logPayload, response.body.error.message);
    }

    void reply.status(response.httpStatus).send(response.body);
  }

  private toResponse(exception: unknown, requestId: string): ErrorResponse {
    if (AppError.isAppError(exception)) {
      return toErrorResponse(exception, requestId);
    }

    // Nest's own HTTP exceptions (404 from the router, 413 from the body limit, and so on)
    // are translated rather than leaked as framework-shaped payloads.
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        httpStatus: status,
        body: {
          error: {
            code: mapHttpStatusToCode(status),
            message: exception.message,
            requestId,
            details: {},
          },
        },
      };
    }

    return toErrorResponse(exception, requestId);
  }
}

function mapHttpStatusToCode(status: number): (typeof ErrorCode)[keyof typeof ErrorCode] {
  switch (status) {
    case 400:
      return ErrorCode.VALIDATION_FAILED;
    case 401:
      return ErrorCode.UNAUTHENTICATED;
    case 403:
      return ErrorCode.FORBIDDEN;
    case 404:
      return ErrorCode.NOT_FOUND;
    case 409:
      return ErrorCode.CONFLICT;
    case 413:
      return ErrorCode.REQUEST_TOO_LARGE;
    case 429:
      return ErrorCode.RATE_LIMITED;
    case 503:
      return ErrorCode.SERVICE_UNAVAILABLE;
    default:
      return status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.VALIDATION_FAILED;
  }
}
