export const SERVICE_NAMES = [
  "identity",
  "merchant",
  "payment",
  "ledger",
  "settlement",
  "reconciliation",
  "risk",
] as const;

export type ServiceName = (typeof SERVICE_NAMES)[number];

export function isServiceName(value: string): value is ServiceName {
  return (SERVICE_NAMES as readonly string[]).includes(value);
}

export function serviceBaseUrl(service: ServiceName): string {
  const urls: Record<ServiceName, string | undefined> = {
    identity: process.env.IDENTITY_URL,
    merchant: process.env.MERCHANT_URL,
    payment: process.env.PAYMENT_URL,
    ledger: process.env.LEDGER_URL,
    settlement: process.env.SETTLEMENT_URL,
    reconciliation: process.env.RECONCILIATION_URL,
    risk: process.env.RISK_URL,
  };
  return (
    urls[service] ??
    {
      identity: "http://127.0.0.1:3001",
      merchant: "http://127.0.0.1:3002",
      payment: "http://127.0.0.1:3003",
      ledger: "http://127.0.0.1:3004",
      settlement: "http://127.0.0.1:3005",
      reconciliation: "http://127.0.0.1:3006",
      risk: "http://127.0.0.1:3007",
    }[service]
  );
}

export const HEALTH_TARGETS: readonly { name: string; url: string }[] = [
  { name: "identity", url: "http://127.0.0.1:3001" },
  { name: "merchant", url: "http://127.0.0.1:3002" },
  { name: "payment", url: "http://127.0.0.1:3003" },
  { name: "ledger", url: "http://127.0.0.1:3004" },
  { name: "settlement", url: "http://127.0.0.1:3005" },
  { name: "reconciliation", url: "http://127.0.0.1:3006" },
  { name: "risk", url: "http://127.0.0.1:3007" },
  { name: "notification", url: "http://127.0.0.1:3008" },
  { name: "acquirer", url: "http://127.0.0.1:3009" },
];
