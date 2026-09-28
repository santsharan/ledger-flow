import { NextResponse } from "next/server";
import { readSession } from "@/lib/identity";

const TARGETS: readonly { name: string; env: string; fallback: string }[] = [
  { name: "identity", env: "IDENTITY_URL", fallback: "http://127.0.0.1:3001" },
  { name: "merchant", env: "MERCHANT_URL", fallback: "http://127.0.0.1:3002" },
  { name: "payment", env: "PAYMENT_URL", fallback: "http://127.0.0.1:3003" },
  { name: "ledger", env: "LEDGER_URL", fallback: "http://127.0.0.1:3004" },
  { name: "settlement", env: "SETTLEMENT_URL", fallback: "http://127.0.0.1:3005" },
  { name: "reconciliation", env: "RECONCILIATION_URL", fallback: "http://127.0.0.1:3006" },
  { name: "risk", env: "RISK_URL", fallback: "http://127.0.0.1:3007" },
  { name: "notification", env: "NOTIFICATION_URL", fallback: "http://127.0.0.1:3008" },
  { name: "acquirer", env: "ACQUIRER_URL", fallback: "http://127.0.0.1:3009" },
];

export async function GET(): Promise<NextResponse> {
  const session = await readSession();
  if (session.user === null) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Sign in required.", requestId: null } },
      { status: 401 },
    );
  }
  const checks = await Promise.all(
    TARGETS.map(async (target) => {
      const base = process.env[target.env] ?? target.fallback;
      try {
        const response = await fetch(`${base}/health/ready`, {
          cache: "no-store",
          signal: AbortSignal.timeout(1500),
        });
        return { name: target.name, ok: response.ok, status: response.status };
      } catch {
        return { name: target.name, ok: false, status: 0 };
      }
    }),
  );
  return NextResponse.json({ checks });
}
