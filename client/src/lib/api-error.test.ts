import { describe, expect, it } from "vitest";
import { ApiError } from "./api-error";

describe("ApiError", () => {
  it("reads the LedgerFlow error envelope", () => {
    const error = new ApiError(409, {
      error: {
        code: "IDEMPOTENCY_CONFLICT",
        message: "This key was already used for a different request.",
        requestId: "req-1",
        details: { key: "abc" },
      },
    });
    expect(error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(error.requestId).toBe("req-1");
    expect(error.message).toContain("different request");
  });

  it("stays readable when the body is not an envelope", () => {
    const error = new ApiError(502, null);
    expect(error.code).toBe("REQUEST_FAILED");
    expect(error.message).toContain("502");
  });
});
