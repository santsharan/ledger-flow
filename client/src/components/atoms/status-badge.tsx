const TONE: Record<string, string> = {
  ok: "border-ok/40 bg-ok/10 text-ok",
  danger: "border-danger/40 bg-danger/10 text-danger",
  warning: "border-warning/40 bg-warning/10 text-warning",
  neutral: "border-line bg-paper text-ink-soft",
};

function toneFor(status: string): keyof typeof TONE {
  if (status.endsWith("_UNKNOWN") || status === "SETTLEMENT_UNKNOWN") return "warning";
  if (
    status.includes("FAILED") ||
    status === "RISK_DECLINED" ||
    status === "DECLINE" ||
    status === "FAILED"
  ) {
    return "danger";
  }
  if (
    status === "CAPTURED" ||
    status === "CONFIRMED" ||
    status === "RESOLVED" ||
    status === "POSTED" ||
    status === "ALLOW" ||
    status === "ACTIVE" ||
    status === "MERCHANT_ACTIVE"
  ) {
    return "ok";
  }
  return "neutral";
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      role="status"
      data-status={status}
      className={`inline-flex items-center rounded border px-2 py-0.5 font-mono text-xs tracking-wide ${TONE[toneFor(status)]}`}
    >
      {status}
    </span>
  );
}
