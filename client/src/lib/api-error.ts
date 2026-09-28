export interface ApiErrorBody {
  readonly code: string;
  readonly message: string;
  readonly requestId: string | null;
  readonly details: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly details: unknown;

  constructor(status: number, body: unknown) {
    const error = readError(body);
    super(error?.message ?? `Request failed (${status}).`);
    this.name = "ApiError";
    this.status = status;
    this.code = error?.code ?? "REQUEST_FAILED";
    this.requestId = error?.requestId ?? null;
    this.details = error?.details ?? null;
  }
}

function readError(body: unknown): ApiErrorBody | null {
  if (typeof body !== "object" || body === null || !("error" in body)) return null;
  const error = body.error;
  if (typeof error !== "object" || error === null) return null;
  const record = error as Record<string, unknown>;
  return {
    code: typeof record.code === "string" ? record.code : "REQUEST_FAILED",
    message: typeof record.message === "string" ? record.message : "Request failed.",
    requestId: typeof record.requestId === "string" ? record.requestId : null,
    details: "details" in record ? record.details : null,
  };
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    const request = error.requestId === null ? "" : ` Request ${error.requestId}.`;
    return `${error.code}: ${error.message}${request}`;
  }
  return "The request did not finish. Reload the record before trying again. Do not assume the money movement succeeded.";
}
