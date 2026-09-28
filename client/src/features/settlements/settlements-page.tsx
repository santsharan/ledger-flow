"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/atoms/button";
import { Field, Input, TextArea } from "@/components/atoms/fields";
import { StatusBadge } from "@/components/atoms/status-badge";
import { DataTable, Pagination } from "@/components/molecules/data-table";
import { EmptyState, ErrorState, LoadingState } from "@/components/molecules/states";
import { useSession } from "@/components/session-context";
import { useConfirm, useToast } from "@/hooks/use-console";
import { api } from "@/lib/api";
import { describeError } from "@/lib/api-error";
import { formatMinor } from "@/lib/money";
import { Permission, can } from "@/lib/permissions";

interface SettlementView {
  id: string;
  merchantId: string;
  settlementDate: string;
  currency: string;
  status: string;
  digest: string | null;
  totals: {
    gross: string;
    fees: string;
    refunds: string;
    chargebacks: string;
    adjustments: string;
    net: string;
  } | null;
}

const ACTIONS: Record<string, { path: string; label: string; needsPayable?: boolean }[]> = {
  CREATED: [{ path: "calculate", label: "Calculate" }],
  CALCULATED: [{ path: "approve", label: "Approve", needsPayable: true }, { path: "fail", label: "Fail" }],
  APPROVED: [{ path: "submit", label: "Submit" }],
  SUBMITTED: [
    { path: "confirm", label: "Confirm" },
    { path: "unknown", label: "Mark unknown" },
    { path: "fail", label: "Fail" },
  ],
  SETTLEMENT_UNKNOWN: [
    { path: "confirm", label: "Confirm" },
    { path: "fail", label: "Fail" },
  ],
  CONFIRMED: [{ path: "reverse", label: "Reverse" }],
};

export function SettlementsPage() {
  const session = useSession();
  const [offset, setOffset] = useState(0);
  const limit = 25;
  const query = useQuery({
    queryKey: ["settlements", offset],
    enabled: can(session.permissions, Permission.SETTLEMENTS_READ),
    queryFn: () =>
      api<{ settlements: SettlementView[] }>("settlement", `settlements?limit=${limit}&offset=${offset}`),
  });
  if (!can(session.permissions, Permission.SETTLEMENTS_READ)) {
    return <ErrorState title="Settlements are hidden" body="settlements.read is required." />;
  }
  const rows = query.data?.settlements ?? [];
  const failed = rows.filter((row) => row.status === "FAILED" || row.status === "SETTLEMENT_UNKNOWN");
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Settlements</h1>
        <p className="mt-1 text-sm text-ink-soft">Fees are basis points plus a fixed minor amount. Totals are frozen at calculation.</p>
      </header>
      {can(session.permissions, Permission.SETTLEMENTS_APPROVE) ? <CreateSettlement /> : null}
      {query.isLoading ? <LoadingState label="Loading settlements…" /> : null}
      {query.isError ? <ErrorState title="Settlements unavailable" body={describeError(query.error)} /> : null}
      {rows.length === 0 && !query.isLoading ? <EmptyState title="No settlements" body="Open a batch for a merchant, date, and currency." /> : null}
      {failed.length > 0 ? <p className="text-sm text-warning">{failed.length} failed or unknown batches on this page.</p> : null}
      {rows.length > 0 ? (
        <DataTable<SettlementView>
          rows={rows}
          rowKey={(row) => row.id}
          columns={[
            {
              key: "id",
              header: "Batch",
              render: (row) => (
                <Link className="font-mono text-xs text-accent underline" href={`/settlements/${row.id}`}>
                  {row.id}
                </Link>
              ),
            },
            { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
            { key: "date", header: "Date", render: (row) => row.settlementDate },
            {
              key: "net",
              header: "Net",
              render: (row) => (row.totals === null ? "Not calculated" : formatMinor(row.totals.net, row.currency)),
            },
          ]}
        />
      ) : null}
      <Pagination offset={offset} limit={limit} count={rows.length} onChange={setOffset} />
    </div>
  );
}

function CreateSettlement() {
  const toast = useToast();
  const client = useQueryClient();
  const router = useRouter();
  const [body, setBody] = useState(
    JSON.stringify(
      {
        merchantId: "",
        settlementDate: new Date().toISOString().slice(0, 10),
        currency: "INR",
        feeVersion: "v1",
        feeBasisPoints: 250,
        fixedFeeMinor: "0",
        items: [{ itemType: "CAPTURE", sourceId: "", amountMinor: "100000", currency: "INR" }],
      },
      null,
      2,
    ),
  );
  async function create() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body) as unknown;
    } catch {
      toast({ tone: "danger", text: "Settlement JSON is not valid." });
      return;
    }
    try {
      const created = await api<SettlementView>("settlement", "settlements", {
        method: "POST",
        body: parsed,
      });
      await client.invalidateQueries({ queryKey: ["settlements"] });
      router.push(`/settlements/${created.id}`);
    } catch (error) {
      toast({ tone: "danger", text: describeError(error) });
    }
  }
  return (
    <section className="space-y-2">
      <Field label="New batch" htmlFor="settlement-json">
        <TextArea id="settlement-json" value={body} onChange={(event) => setBody(event.target.value)} />
      </Field>
      <Button type="button" onClick={create}>
        Open batch
      </Button>
    </section>
  );
}

export function SettlementDetail({ settlementId }: { settlementId: string }) {
  const session = useSession();
  const confirm = useConfirm();
  const toast = useToast();
  const client = useQueryClient();
  const [reason, setReason] = useState("");
  const [payable, setPayable] = useState("");
  const query = useQuery({
    queryKey: ["settlement", settlementId],
    queryFn: () => api<SettlementView>("settlement", `settlements/${settlementId}`),
  });
  if (query.isLoading) return <LoadingState label="Loading settlement…" />;
  if (query.isError || query.data === undefined) {
    return <ErrorState title="Settlement unavailable" body={describeError(query.error)} />;
  }
  const settlement = query.data;
  const actions = can(session.permissions, Permission.SETTLEMENTS_APPROVE) ? (ACTIONS[settlement.status] ?? []) : [];

  async function run(action: { path: string; label: string; needsPayable?: boolean }) {
    const accepted = await confirm({
      title: action.label,
      confirmLabel: action.label,
      danger: action.path === "fail" || action.path === "reverse",
      body: `${action.label} settlement ${settlement.id}. Reason: ${reason}`,
    });
    if (!accepted) return;
    const payload: Record<string, string> = { reason };
    if (action.needsPayable) payload.availablePayableMinor = payable;
    try {
      await api("settlement", `settlements/${settlementId}/${action.path}`, { method: "POST", body: payload });
      await client.invalidateQueries({ queryKey: ["settlement", settlementId] });
      toast({ tone: "ok", text: `${action.label} accepted.` });
    } catch (error) {
      toast({ tone: "danger", text: describeError(error) });
    }
  }

  async function reproduce() {
    try {
      const result = await api<{ digest: string; matches: boolean }>(
        "settlement",
        `settlements/${settlementId}/reproduction`,
      );
      toast({
        tone: result.matches ? "ok" : "danger",
        text: result.matches ? "Snapshot matches the stored inputs." : "Snapshot does not match. Do not treat the totals as reproduced.",
      });
    } catch (error) {
      toast({ tone: "danger", text: describeError(error) });
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Settlement</h1>
      <StatusBadge status={settlement.status} />
      <p className="text-sm">
        {settlement.settlementDate} · {settlement.currency}
      </p>
      {settlement.totals === null ? (
        <p className="text-sm text-ink-soft">Totals are not frozen yet.</p>
      ) : (
        <dl className="grid gap-2 sm:grid-cols-3">
          {Object.entries(settlement.totals).map(([key, value]) => (
            <div key={key} className="rounded border border-line bg-panel px-3 py-2">
              <dt className="text-xs uppercase text-ink-soft">{key}</dt>
              <dd className="font-mono">{formatMinor(value, settlement.currency)}</dd>
            </div>
          ))}
        </dl>
      )}
      {settlement.digest ? <p className="break-all font-mono text-xs">Digest {settlement.digest}</p> : null}
      {settlement.totals !== null ? (
        <Button type="button" variant="quiet" onClick={reproduce}>
          Check reproduction
        </Button>
      ) : null}
      {actions.length > 0 ? (
        <div className="max-w-lg space-y-2">
          <Field label="Reason" htmlFor="settlement-reason">
            <Input id="settlement-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
          </Field>
          {actions.some((action) => action.needsPayable) ? (
            <Field label="Available payable, minor units" htmlFor="payable">
              <Input id="payable" value={payable} onChange={(event) => setPayable(event.target.value.replace(/[^\d-]/g, ""))} />
            </Field>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <Button
                key={action.path}
                type="button"
                variant={action.path === "fail" || action.path === "reverse" ? "danger" : "primary"}
                disabled={reason.trim().length < 3}
                onClick={() => run(action)}
              >
                {action.label}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
