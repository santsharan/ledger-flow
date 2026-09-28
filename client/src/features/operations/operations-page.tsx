"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { StatusBadge } from "@/components/atoms/status-badge";
import { DataTable } from "@/components/molecules/data-table";
import { EmptyState, ErrorState, LoadingState } from "@/components/molecules/states";
import { useSession } from "@/components/session-context";
import { api } from "@/lib/api";
import { describeError } from "@/lib/api-error";
import { Permission, can } from "@/lib/permissions";

interface OutboxEvent {
  id: string;
  eventType: string;
  status: string;
  aggregateId: string;
  attemptCount: number;
  createdAt: string;
}

interface DeadLetters {
  available: boolean;
  letters: { id: string; consumer: string; errorCode: string; errorMessage: string; createdAt: string }[];
}

export function OperationsPage() {
  const session = useSession();
  const allowed = can(session.permissions, Permission.ADMIN_OPERATIONS);
  const outbox = useQuery({
    queryKey: ["outbox"],
    enabled: allowed,
    queryFn: () => api<{ events: OutboxEvent[] }>("payment", "operations/outbox?limit=50"),
  });
  const dead = useQuery({
    queryKey: ["dead-letters"],
    enabled: allowed,
    queryFn: () => api<DeadLetters>("payment", "operations/dead-letters?limit=50"),
  });
  const unknown = useQuery({
    queryKey: ["unknown-payments"],
    enabled: allowed && can(session.permissions, Permission.PAYMENTS_READ),
    queryFn: () => api<{ payments: { id: string; status: string }[] }>("payment", "payments?status=AUTHORIZATION_UNKNOWN&limit=50"),
  });
  const health = useQuery({
    queryKey: ["ops-health"],
    enabled: allowed,
    queryFn: async () => {
      const response = await fetch("/api/health");
      if (!response.ok) throw new Error("unreachable");
      return (await response.json()) as { checks: { name: string; ok: boolean }[] };
    },
  });

  if (!allowed) {
    return (
      <ErrorState
        title="Operations are restricted"
        body="admin.operations is required. Replay is also not exposed as an HTTP call, so admin.replay has nothing to press."
      />
    );
  }

  const events = outbox.data?.events ?? [];
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Operations</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-soft">
          Outbox rows are the publication record. There is no replay button because replaying a money event from the
          browser would skip the service idempotency checks.
        </p>
      </header>
      <section className="space-y-2">
        <h2 className="text-lg font-medium">Health</h2>
        {health.isLoading ? <LoadingState label="Checking services…" /> : null}
        <ul className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {(health.data?.checks ?? []).map((check) => (
            <li key={check.name} className="rounded border border-line bg-panel px-3 py-2 text-sm">
              {check.name} · {check.ok ? "READY" : "NOT READY"}
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-medium">Unknown authorizations</h2>
        {(unknown.data?.payments ?? []).length === 0 ? (
          <EmptyState title="None on this page" body="AUTHORIZATION_UNKNOWN payments are listed here." />
        ) : (
          <ul>
            {unknown.data?.payments.map((payment) => (
              <li key={payment.id}>
                <Link className="font-mono text-xs text-accent underline" href={`/payments/${payment.id}`}>
                  {payment.id}
                </Link>{" "}
                <StatusBadge status={payment.status} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-medium">Outbox</h2>
        {outbox.isLoading ? <LoadingState label="Loading outbox…" /> : null}
        {outbox.isError ? <ErrorState title="Outbox unavailable" body={describeError(outbox.error)} /> : null}
        {events.length === 0 && !outbox.isLoading ? <EmptyState title="Outbox is empty" body="A capture writes a row in the same transaction as the payment." /> : null}
        {events.length > 0 ? (
          <DataTable<OutboxEvent>
            rows={events}
            rowKey={(row) => row.id}
            columns={[
              { key: "type", header: "Event", render: (row) => row.eventType },
              { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
              { key: "aggregate", header: "Aggregate", render: (row) => row.aggregateId },
              { key: "attempts", header: "Attempts", render: (row) => String(row.attemptCount) },
            ]}
          />
        ) : null}
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-medium">Dead letters</h2>
        {dead.data?.available === false ? (
          <EmptyState
            title="No dead-letter table on the payment service"
            body="Malformed consumer events are stored where a consumer runs. Failed outbox rows above are the publication signal."
          />
        ) : null}
        {(dead.data?.letters.length ?? 0) > 0 ? (
          <ul className="space-y-1 text-sm">
            {dead.data?.letters.map((letter) => (
              <li key={letter.id}>
                {letter.errorCode} · {letter.consumer} · {letter.errorMessage}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <p className="text-sm">
        <Link className="text-accent underline" href="/settlements">
          Failed settlements live on the settlement list.
        </Link>
      </p>
    </div>
  );
}
