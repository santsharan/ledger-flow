"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { useEffect, useState } from "react";
import { Button } from "@/components/atoms/button";
import { Field, Input, Select, TextArea } from "@/components/atoms/fields";
import { StatusBadge } from "@/components/atoms/status-badge";
import { DataTable } from "@/components/molecules/data-table";
import { EmptyState, ErrorState, LoadingState } from "@/components/molecules/states";
import { useSession } from "@/components/session-context";
import { useConfirm, useToast } from "@/hooks/use-console";
import { api } from "@/lib/api";
import { describeError } from "@/lib/api-error";
import { Permission, can } from "@/lib/permissions";
import { nextCaseStatuses } from "@/lib/workflows";
import { selectedCaseIdAtom } from "@/state/atoms";

interface CaseRow {
  id: string;
  status: string;
  caseType: string;
  resultType: string;
  deltaMinor: string | null;
}

interface RunView {
  runId: string;
  results: {
    id: string;
    resultType: string;
    deltaMinor: string | null;
    caseId: string | null;
    internalReference: string | null;
    externalReference: string | null;
  }[];
}

export function ReconciliationPage() {
  const session = useSession();
  if (!can(session.permissions, Permission.RECONCILIATION_READ)) {
    return <ErrorState title="Reconciliation is hidden" body="reconciliation.read is required." />;
  }
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Reconciliation</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-soft">
          Differences stay visible. Resolving a case records a reason. It does not change the payment or the ledger.
        </p>
      </header>
      <ImportStatement />
      <CaseList />
    </div>
  );
}

function CaseList() {
  const query = useQuery({
    queryKey: ["cases"],
    queryFn: () => api<CaseRow[]>("reconciliation", "reconciliation/cases"),
  });
  if (query.isLoading) return <LoadingState label="Loading cases…" />;
  if (query.isError) return <ErrorState title="Cases unavailable" body={describeError(query.error)} />;
  const rows = query.data ?? [];
  if (rows.length === 0) return <EmptyState title="No cases" body="A mismatch, a missing row, or a duplicate opens a case." />;
  return (
    <DataTable<CaseRow>
      rows={rows}
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
        { key: "delta", header: "Delta minor", render: (row) => row.deltaMinor ?? "—" },
      ]}
    />
  );
}

function ImportStatement() {
  const toast = useToast();
  const client = useQueryClient();
  const [provider, setProvider] = useState("demo-acquirer");
  const [statement, setStatement] = useState(
    "externalReference,paymentReference,amountMinor,currency,settlementDate,status\n",
  );
  const [internal, setInternal] = useState("[]");
  const [run, setRun] = useState<RunView | null>(null);

  async function submit() {
    let parsedInternal: unknown;
    try {
      parsedInternal = JSON.parse(internal);
    } catch {
      toast({ tone: "danger", text: "Internal rows must be JSON." });
      return;
    }
    try {
      const result = await api<RunView>("reconciliation", "reconciliation/runs", {
        method: "POST",
        body: { provider, format: "CSV", statement, internal: parsedInternal },
      });
      setRun(result);
      await client.invalidateQueries({ queryKey: ["cases"] });
      toast({ tone: "ok", text: `Run ${result.runId} stored. Identical files reuse this run.` });
    } catch (error) {
      toast({ tone: "danger", text: describeError(error) });
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium">Import statement</h2>
      <Field label="Provider" htmlFor="provider">
        <Input id="provider" value={provider} onChange={(event) => setProvider(event.target.value)} />
      </Field>
      <Field label="CSV statement" htmlFor="statement">
        <TextArea id="statement" value={statement} onChange={(event) => setStatement(event.target.value)} />
      </Field>
      <Field label="Internal transactions JSON" hint='[{"paymentReference":"...","providerReference":null,"amountMinor":"10000","currency":"INR","settlementDate":"2026-09-25","status":"CAPTURED"}]' htmlFor="internal">
        <TextArea id="internal" value={internal} onChange={(event) => setInternal(event.target.value)} />
      </Field>
      <Button type="button" onClick={submit}>
        Import
      </Button>
      {run ? (
        <ul className="space-y-1 text-sm">
          {run.results.map((result) => (
            <li key={result.id}>
              <StatusBadge status={result.resultType} />{" "}
              {result.deltaMinor === null ? "no delta" : `delta ${result.deltaMinor}`}
              {result.caseId ? (
                <Link className="ml-2 text-accent underline" href={`/reconciliation/${result.caseId}`}>
                  case
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function CaseDetail({ caseId }: { caseId: string }) {
  const session = useSession();
  const setSelected = useSetAtom(selectedCaseIdAtom);
  const confirm = useConfirm();
  const toast = useToast();
  const client = useQueryClient();
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  useEffect(() => {
    setSelected(caseId);
  }, [caseId, setSelected]);
  const query = useQuery({
    queryKey: ["case", caseId],
    queryFn: () =>
      api<{
        id: string;
        status: string;
        caseType: string;
        actions: { actorId: string; previousStatus: string; newStatus: string; reason: string }[];
      }>("reconciliation", `reconciliation/cases/${caseId}`),
  });
  if (query.isLoading) return <LoadingState label="Loading case…" />;
  if (query.isError || query.data === undefined) {
    return <ErrorState title="Case unavailable" body={describeError(query.error)} />;
  }
  const item = query.data;
  const options = nextCaseStatuses(item.status);

  async function resolve() {
    const accepted = await confirm({
      title: `Move case to ${to}`,
      confirmLabel: "Record resolution",
      body: `Reason: ${reason}\nThis writes an audit action. It does not edit the statement row.`,
    });
    if (!accepted) return;
    try {
      await api("reconciliation", `reconciliation/cases/${caseId}/resolve`, {
        method: "POST",
        body: { to, reason },
      });
      await client.invalidateQueries({ queryKey: ["case", caseId] });
      toast({ tone: "ok", text: "Case updated." });
    } catch (error) {
      toast({ tone: "danger", text: describeError(error) });
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Reconciliation case</h1>
      <StatusBadge status={item.status} />
      <p className="text-sm">{item.caseType}</p>
      <ol className="space-y-2 border-l border-line pl-4 text-sm">
        {item.actions.map((action, index) => (
          <li key={`${action.newStatus}-${index}`}>
            {action.previousStatus} → {action.newStatus}. {action.reason}
            <span className="block font-mono text-xs text-ink-soft">{action.actorId}</span>
          </li>
        ))}
      </ol>
      {options.length > 0 && can(session.permissions, Permission.RECONCILIATION_RESOLVE) ? (
        <div className="max-w-lg space-y-2">
          <Field label="Next status" htmlFor="case-to">
            <Select id="case-to" value={to} onChange={(event) => setTo(event.target.value)}>
              <option value="">Choose</option>
              {options.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reason" htmlFor="case-reason">
            <Input id="case-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
          </Field>
          <Button type="button" disabled={to === "" || reason.trim().length < 3} onClick={resolve}>
            Record
          </Button>
        </div>
      ) : (
        <p className="text-sm text-ink-soft">This case has no further transitions, or you do not have reconciliation.resolve.</p>
      )}
    </div>
  );
}
