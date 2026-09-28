"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Field, Input } from "@/components/atoms/fields";
import { DataTable } from "@/components/molecules/data-table";
import { EmptyState, ErrorState, LoadingState } from "@/components/molecules/states";
import { useSession } from "@/components/session-context";
import { api } from "@/lib/api";
import { describeError } from "@/lib/api-error";
import { Permission, can } from "@/lib/permissions";

interface AuditEvent {
  id: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  reason: string | null;
  requestId: string | null;
  createdAt: string;
}

function AuditBody() {
  const session = useSession();
  const params = useSearchParams();
  const initial = params.get("resourceId") ?? "";
  const [resourceId, setResourceId] = useState(initial);
  const [applied, setApplied] = useState(initial);
  const query = useQuery({
    queryKey: ["audit", applied],
    enabled: can(session.permissions, Permission.PAYMENTS_READ),
    queryFn: () => {
      const search = new URLSearchParams({ limit: "50" });
      if (applied !== "") search.set("resourceId", applied);
      return api<{ events: AuditEvent[] }>("payment", `audit/events?${search.toString()}`);
    },
  });
  if (!can(session.permissions, Permission.PAYMENTS_READ)) {
    return <ErrorState title="Audit is hidden" body="Payment audit requires payments.read. Other services keep their own trails." />;
  }
  const rows = query.data?.events ?? [];
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Audit</h1>
      <p className="text-sm text-ink-soft">Append-only payment audit. Rows cannot be edited or deleted from this console.</p>
      <form
        className="flex max-w-xl items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied(resourceId.trim());
        }}
      >
        <Field label="Resource id" htmlFor="resource-id">
          <Input id="resource-id" value={resourceId} onChange={(event) => setResourceId(event.target.value)} />
        </Field>
        <button type="submit" className="rounded-md border border-line px-3 py-2 text-sm">
          Filter
        </button>
      </form>
      {query.isLoading ? <LoadingState label="Loading audit…" /> : null}
      {query.isError ? <ErrorState title="Audit unavailable" body={describeError(query.error)} /> : null}
      {rows.length === 0 && !query.isLoading ? <EmptyState title="No audit events" body="Events appear when a payment changes." /> : null}
      {rows.length > 0 ? (
        <DataTable<AuditEvent>
          rows={rows}
          rowKey={(row) => row.id}
          columns={[
            { key: "when", header: "When", render: (row) => row.createdAt },
            { key: "action", header: "Action", render: (row) => row.action },
            { key: "resource", header: "Resource", render: (row) => `${row.resourceType} ${row.resourceId}` },
            { key: "actor", header: "Actor", render: (row) => row.actorId },
            { key: "reason", header: "Reason", render: (row) => row.reason ?? "—" },
          ]}
        />
      ) : null}
    </div>
  );
}

export function AuditPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading audit…" />}>
      <AuditBody />
    </Suspense>
  );
}
