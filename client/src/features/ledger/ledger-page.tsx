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

interface Account {
  id: string;
  merchantId: string | null;
  accountCode: string;
  accountType: string;
  currency: string;
  status: string;
}

interface JournalSummary {
  id: string;
  referenceType: string;
  referenceId: string;
  currency: string;
  description: string;
  status: string;
  postedAt: string;
}

export function LedgerPage() {
  const session = useSession();
  if (!can(session.permissions, Permission.LEDGER_READ)) {
    return <ErrorState title="Ledger is hidden" body="ledger.read is required. Hiding this page is not the security control." />;
  }
  return (
    <div className="space-y-10">
      <header>
        <h1 className="text-2xl font-semibold">Ledger</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink-soft">
          Posted journals are immutable. A correction is a new reversal journal. Human roles are not granted
          ledger.post; that permission belongs to service identities.
        </p>
      </header>
      <Accounts />
      <Journals />
      {can(session.permissions, Permission.LEDGER_POST) ? <PostJournal /> : null}
    </div>
  );
}

function Accounts() {
  const [offset, setOffset] = useState(0);
  const [lookup, setLookup] = useState({ accountCode: "", currency: "INR", merchantId: "" });
  const toast = useToast();
  const router = useRouter();
  const limit = 25;
  const query = useQuery({
    queryKey: ["accounts", offset],
    queryFn: () => api<{ accounts: Account[] }>("ledger", `accounts?limit=${limit}&offset=${offset}`),
  });
  const rows = query.data?.accounts ?? [];

  async function findAccount() {
    const params = new URLSearchParams({ accountCode: lookup.accountCode, currency: lookup.currency });
    if (lookup.merchantId !== "") params.set("merchantId", lookup.merchantId);
    try {
      const account = await api<Account>("ledger", `accounts/lookup?${params.toString()}`);
      router.push(`/ledger/accounts/${account.id}`);
    } catch (error) {
      toast({ tone: "danger", text: describeError(error) });
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium">Accounts</h2>
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Account code" htmlFor="account-code">
          <Input id="account-code" value={lookup.accountCode} onChange={(event) => setLookup({ ...lookup, accountCode: event.target.value.toUpperCase() })} />
        </Field>
        <Field label="Currency" htmlFor="lookup-currency">
          <Input id="lookup-currency" value={lookup.currency} onChange={(event) => setLookup({ ...lookup, currency: event.target.value.toUpperCase() })} />
        </Field>
        <Field label="Merchant id" hint="Leave empty for a platform account." htmlFor="lookup-merchant">
          <Input id="lookup-merchant" value={lookup.merchantId} onChange={(event) => setLookup({ ...lookup, merchantId: event.target.value })} />
        </Field>
        <div className="flex items-end">
          <Button type="button" variant="quiet" onClick={findAccount}>
            Look up
          </Button>
        </div>
      </div>
      {query.isLoading ? <LoadingState label="Loading accounts…" /> : null}
      {query.isError ? <ErrorState title="Accounts unavailable" body={describeError(query.error)} /> : null}
      {rows.length === 0 && !query.isLoading ? <EmptyState title="No accounts" body="Accounts appear after the ledger service opens them." /> : null}
      {rows.length > 0 ? (
        <DataTable<Account>
          rows={rows}
          rowKey={(row) => row.id}
          columns={[
            {
              key: "code",
              header: "Code",
              render: (row) => (
                <Link className="text-accent underline" href={`/ledger/accounts/${row.id}`}>
                  {row.accountCode}
                </Link>
              ),
            },
            { key: "type", header: "Type", render: (row) => row.accountType },
            { key: "currency", header: "Currency", render: (row) => row.currency },
            { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
          ]}
        />
      ) : null}
      <Pagination offset={offset} limit={limit} count={rows.length} onChange={setOffset} />
    </section>
  );
}

function Journals() {
  const [offset, setOffset] = useState(0);
  const limit = 25;
  const query = useQuery({
    queryKey: ["journals", offset],
    queryFn: () => api<{ journals: JournalSummary[] }>("ledger", `journals?limit=${limit}&offset=${offset}`),
  });
  const rows = query.data?.journals ?? [];
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium">Journals</h2>
      {query.isLoading ? <LoadingState label="Loading journals…" /> : null}
      {query.isError ? <ErrorState title="Journals unavailable" body={describeError(query.error)} /> : null}
      {rows.length === 0 && !query.isLoading ? (
        <EmptyState title="No journals" body="A capture posts a journal. Until then this list stays empty." />
      ) : null}
      {rows.length > 0 ? (
        <DataTable<JournalSummary>
          rows={rows}
          rowKey={(row) => row.id}
          columns={[
            {
              key: "id",
              header: "Journal",
              render: (row) => (
                <Link className="font-mono text-xs text-accent underline" href={`/ledger/journals/${row.id}`}>
                  {row.id}
                </Link>
              ),
            },
            { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
            { key: "ref", header: "Reference", render: (row) => `${row.referenceType} ${row.referenceId}` },
            { key: "description", header: "Description", render: (row) => row.description },
          ]}
        />
      ) : null}
      <Pagination offset={offset} limit={limit} count={rows.length} onChange={setOffset} />
    </section>
  );
}

function PostJournal() {
  const confirm = useConfirm();
  const toast = useToast();
  const client = useQueryClient();
  const router = useRouter();
  const [body, setBody] = useState(
    JSON.stringify(
      {
        transactionId: "",
        referenceType: "MANUAL",
        referenceId: "",
        currency: "INR",
        description: "",
        lines: [
          { accountId: "", direction: "DEBIT", amountMinor: "10000", currency: "INR" },
          { accountId: "", direction: "CREDIT", amountMinor: "10000", currency: "INR" },
        ],
      },
      null,
      2,
    ),
  );

  async function submit() {
    let parsed: { lines?: { direction: string; amountMinor: string }[] };
    try {
      parsed = JSON.parse(body) as typeof parsed;
    } catch {
      toast({ tone: "danger", text: "Journal JSON is not valid." });
      return;
    }
    const debit = sum(parsed.lines, "DEBIT");
    const credit = sum(parsed.lines, "CREDIT");
    if (debit !== credit) {
      toast({ tone: "danger", text: "Debits and credits are not equal. Nothing was sent." });
      return;
    }
    const accepted = await confirm({
      title: "Post journal",
      confirmLabel: "Post",
      danger: true,
      body: `Debit ${debit} and credit ${credit} minor units. A posted journal cannot be edited.`,
    });
    if (!accepted) return;
    try {
      const posted = await api<{ id: string }>("ledger", "journals", { method: "POST", body: parsed });
      await client.invalidateQueries({ queryKey: ["journals"] });
      toast({ tone: "ok", text: "Journal posted. It is now immutable." });
      router.push(`/ledger/journals/${posted.id}`);
    } catch (error) {
      toast({ tone: "danger", text: describeError(error) });
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium">Post journal</h2>
      <Field label="Journal JSON" hint="Amounts stay integer strings. The service rejects an unbalanced journal." htmlFor="journal-json">
        <TextArea id="journal-json" value={body} onChange={(event) => setBody(event.target.value)} />
      </Field>
      <Button type="button" onClick={submit}>
        Post journal
      </Button>
    </section>
  );
}

function sum(lines: { direction: string; amountMinor: string }[] | undefined, direction: string): string {
  let total = BigInt(0);
  for (const line of lines ?? []) {
    if (line.direction === direction && /^\d+$/.test(line.amountMinor)) total += BigInt(line.amountMinor);
  }
  return total.toString();
}

export function AccountDetail({ accountId }: { accountId: string }) {
  const account = useQuery({
    queryKey: ["account", accountId],
    queryFn: () => api<Account>("ledger", `accounts/${accountId}`),
  });
  const balance = useQuery({
    queryKey: ["balance", accountId],
    queryFn: () =>
      api<{ balanceMinor: string; debitMinor: string; creditMinor: string; currency: string }>(
        "ledger",
        `accounts/${accountId}/balance`,
      ),
  });
  const entries = useQuery({
    queryKey: ["entries", accountId],
    queryFn: () =>
      api<{ entries: { accountId: string; direction: string; amountMinor: string; currency: string; sequence: number }[] }>(
        "ledger",
        `accounts/${accountId}/entries?limit=50`,
      ),
  });
  if (account.isLoading) return <LoadingState label="Loading account…" />;
  if (account.isError || account.data === undefined) {
    return <ErrorState title="Account unavailable" body={describeError(account.error)} />;
  }
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{account.data.accountCode}</h1>
      <p className="text-sm text-ink-soft">
        {account.data.accountType} · {account.data.currency} · <StatusBadge status={account.data.status} />
      </p>
      {balance.data ? (
        <p className="font-mono text-xl">{formatMinor(balance.data.balanceMinor, balance.data.currency)}</p>
      ) : null}
      <p className="text-xs text-ink-soft">Entries are append-only. This screen has no delete or edit control.</p>
      <ul className="space-y-1 text-sm">
        {(entries.data?.entries ?? []).map((entry) => (
          <li key={`${entry.sequence}-${entry.direction}`} className="font-mono">
            {entry.direction} {formatMinor(entry.amountMinor, entry.currency)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function JournalDetail({ journalId }: { journalId: string }) {
  const session = useSession();
  const confirm = useConfirm();
  const toast = useToast();
  const client = useQueryClient();
  const [reason, setReason] = useState("");
  const query = useQuery({
    queryKey: ["journal", journalId],
    queryFn: () =>
      api<{
        id: string;
        status: string;
        description: string;
        currency: string;
        referenceType: string;
        referenceId: string;
        reversesJournalId: string | null;
        lines: { accountId: string; direction: string; amountMinor: string; currency: string; sequence: number }[];
      }>("ledger", `journals/${journalId}`),
  });
  if (query.isLoading) return <LoadingState label="Loading journal…" />;
  if (query.isError || query.data === undefined) {
    return <ErrorState title="Journal unavailable" body={describeError(query.error)} />;
  }
  const journal = query.data;

  async function reverse() {
    if (!can(session.permissions, Permission.LEDGER_POST)) return;
    const accepted = await confirm({
      title: "Reverse journal",
      confirmLabel: "Reverse",
      danger: true,
      body: "This posts the opposite lines. It does not edit or delete the original.",
    });
    if (!accepted) return;
    try {
      const reversal = await api<{ id: string }>("ledger", `journals/${journalId}/reverse`, {
        method: "POST",
        body: { transactionId: `reverse-${journalId}`, reason },
      });
      await client.invalidateQueries({ queryKey: ["journal", journalId] });
      toast({ tone: "ok", text: `Reversal ${reversal.id} posted.` });
    } catch (error) {
      toast({ tone: "danger", text: describeError(error) });
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Journal</h1>
      <StatusBadge status={journal.status} />
      <p className="text-sm">{journal.description}</p>
      <p className="font-mono text-xs text-ink-soft">
        {journal.referenceType} {journal.referenceId}
      </p>
      <p className="text-sm text-ink-soft">Posted lines cannot be edited.</p>
      <ul className="space-y-1">
        {journal.lines.map((line) => (
          <li key={line.sequence} className="font-mono text-sm">
            {line.direction} {formatMinor(line.amountMinor, line.currency)} · {line.accountId}
          </li>
        ))}
      </ul>
      {journal.reversesJournalId ? (
        <Link className="text-sm text-accent underline" href={`/ledger/journals/${journal.reversesJournalId}`}>
          Original journal
        </Link>
      ) : null}
      {journal.status === "POSTED" && can(session.permissions, Permission.LEDGER_POST) ? (
        <div className="max-w-lg space-y-2">
          <Field label="Reason" htmlFor="reverse-reason">
            <Input id="reverse-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
          </Field>
          <Button type="button" variant="danger" onClick={reverse} disabled={reason.trim().length < 3}>
            Reverse journal
          </Button>
        </div>
      ) : null}
    </div>
  );
}
