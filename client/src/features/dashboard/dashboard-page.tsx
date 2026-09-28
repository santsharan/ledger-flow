"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { StatusBadge } from "@/components/atoms/status-badge";
import { DataTable } from "@/components/molecules/data-table";
import { EmptyState, ErrorState, LoadingState } from "@/components/molecules/states";
import { useSession } from "@/components/session-context";
import { api } from "@/lib/api";
import { describeError } from "@/lib/api-error";
import { formatMinor } from "@/lib/money";
import { Permission, can } from "@/lib/permissions";
import { isUnknownPayment } from "@/lib/workflows";

interface PaymentSummary {
  id: string;
  status: string;
  currency: string;
  amountMinor: string;
  createdAt: string;
}

interface CaseSummary {
  id: string;
  status: string;
  resultType: string;
  deltaMinor: string | null;
}

interface HealthResponse {
  checks: { name: string; ok: boolean; status: number }[];
}

export function DashboardPage() {
  const session = useSession();
  const paymentsEnabled = can(session.permissions, Permission.PAYMENTS_READ);
  const casesEnabled = can(session.permissions, Permission.RECONCILIATION_READ);
  const payments = useQuery({
    queryKey: ["dashboard-payments"],
    enabled: paymentsEnabled,
    queryFn: () => api<{ payments: PaymentSummary[] }>("payment", "payments?limit=50"),
  });
  const cases = useQuery({
    queryKey: ["dashboard-cases"],
    enabled: casesEnabled,
    queryFn: () =>
      api<{ id: string; status: string; caseType: string; resultType: string; deltaMinor: string | null }[]>(
        "reconciliation",
        "reconciliation/cases",
      ),
  });
  const health = useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const response = await fetch("/api/health");
      if (!response.ok) throw new Error("Health check failed.");
      return (await response.json()) as HealthResponse;
    },
  });

  const rows = payments.data?.payments ?? [];
  const unknown = rows.filter((payment) => isUnknownPayment(payment.status));
  const openCases = (cases.data ?? []).filter((item) => item.status === "OPEN" || item.status === "INVESTIGATING");

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-soft">
          Counts below are taken from the latest page each service returned. They are not platform-wide totals.
        </p>
      </header>
      <section className="grid gap-3 sm:grid-cols-3">
        <Metric label="Payments on this page" value={paymentsEnabled ? String(rows.length) : "—"} />
        <Metric label="Unknown outcomes on this page" value={paymentsEnabled ? String(unknown.length) : "—"} />
        <Metric label="Open reconciliation cases" value={casesEnabled ? String(openCases.length) : "—"} />
      </section>
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-lg font-medium">Status mix</h2>
          {!paymentsEnabled ? (
            <EmptyState title="Payments are hidden" body="This principal does not have payments.read." />
          ) : payments.isLoading ? (
            <LoadingState label="Loading payments…" />
          ) : payments.isError ? (
            <ErrorState title="Payments unavailable" body={describeError(payments.error)} />
          ) : (
            <StatusBars rows={rows} />
          )}
        </div>
        <div className="space-y-3">
          <h2 className="text-lg font-medium">Service health</h2>
          {health.isLoading ? <LoadingState label="Checking readiness…" /> : null}
          {health.isError ? <ErrorState title="Health check failed" body={describeError(health.error)} /> : null}
          <ul className="grid grid-cols-2 gap-2">
            {(health.data?.checks ?? []).map((check) => (
              <li key={check.name} className="rounded-md border border-line bg-panel px-3 py-2 text-sm">
                <span className="font-medium">{check.name}</span>
                <span className="mt-1 block font-mono text-xs">{check.ok ? "READY" : "NOT READY"}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Unknown payments</h2>
        {unknown.length === 0 ? (
          <EmptyState title="No unknown payments on this page" body="A lost provider response would appear here as AUTHORIZATION_UNKNOWN, CAPTURE_UNKNOWN, or REFUND_UNKNOWN." />
        ) : (
          <PaymentTable rows={unknown} />
        )}
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Recent payments</h2>
        {rows.length === 0 ? (
          <EmptyState title="No payments yet" body="Create one from Payments when you have payments.create." />
        ) : (
          <PaymentTable rows={rows.slice(0, 8)} />
        )}
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Open reconciliation cases</h2>
        {!casesEnabled ? (
          <EmptyState title="Reconciliation is hidden" body="This principal does not have reconciliation.read." />
        ) : openCases.length === 0 ? (
          <EmptyState title="No open cases" body="Import a statement that does not match internal records to open one." />
        ) : (
          <DataTable<CaseSummary>
            rows={openCases}
            rowKey={(row) => row.id}
            columns={[
              {
                key: "id",
                header: "Case",
                render: (row) => (
                  <Link className="font-mono text-xs text-accent underline" href={`/reconciliation/${row.id}`}>
                    {row.id}
                  </Link>
                ),
              },
              { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
              { key: "result", header: "Result", render: (row) => row.resultType },
              { key: "delta", header: "Delta", render: (row) => row.deltaMinor ?? "—" },
            ]}
          />
        )}
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-ink-soft">{label}</p>
      <p className="mt-1 font-mono text-2xl">{value}</p>
    </div>
  );
}

function StatusBars({ rows }: { rows: PaymentSummary[] }) {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  const max = Math.max(1, ...counts.values());
  if (counts.size === 0) return <EmptyState title="Nothing to chart" body="The latest payment page is empty." />;
  return (
    <ul className="space-y-2">
      {[...counts.entries()].map(([status, count]) => (
        <li key={status} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-sm">
          <div>
            <StatusBadge status={status} />
            <div className="mt-1 h-1.5 rounded bg-line">
              <div className="h-1.5 rounded bg-accent" style={{ width: `${(count / max) * 100}%` }} />
            </div>
          </div>
          <span className="font-mono">{count}</span>
        </li>
      ))}
    </ul>
  );
}

function PaymentTable({ rows }: { rows: PaymentSummary[] }) {
  return (
    <DataTable<PaymentSummary>
      rows={rows}
      rowKey={(row) => row.id}
      columns={[
        {
          key: "id",
          header: "Payment",
          render: (row) => (
            <Link className="font-mono text-xs text-accent underline" href={`/payments/${row.id}`}>
              {row.id}
            </Link>
          ),
        },
        { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
        {
          key: "amount",
          header: "Amount",
          render: (row) => <span className="font-mono">{formatMinor(row.amountMinor, row.currency)}</span>,
        },
        { key: "when", header: "Created", render: (row) => row.createdAt },
      ]}
    />
  );
}
