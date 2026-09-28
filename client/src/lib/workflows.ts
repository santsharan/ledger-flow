export const CASE_NEXT: Readonly<Record<string, readonly string[]>> = {
  OPEN: ["INVESTIGATING", "ESCALATED", "IGNORED_WITH_REASON"],
  INVESTIGATING: ["RESOLVED", "ESCALATED"],
  ESCALATED: ["RESOLVED", "IGNORED_WITH_REASON"],
  RESOLVED: [],
  IGNORED_WITH_REASON: [],
};

export function nextCaseStatuses(status: string): readonly string[] {
  return CASE_NEXT[status] ?? [];
}

export const PAYMENT_STATUSES = [
  "CREATED",
  "AUTHORIZATION_PENDING",
  "AUTHORIZATION_UNKNOWN",
  "AUTHORIZED",
  "AUTHORIZATION_FAILED",
  "CAPTURE_PENDING",
  "CAPTURE_UNKNOWN",
  "CAPTURED",
  "CAPTURE_FAILED",
  "REFUND_PENDING",
  "REFUND_UNKNOWN",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
  "CANCELLED",
  "RISK_DECLINED",
  "EXPIRED",
] as const;

export function isUnknownPayment(status: string): boolean {
  return status.endsWith("_UNKNOWN");
}
