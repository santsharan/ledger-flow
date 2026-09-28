"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/atoms/button";
import { Field, Input, Select } from "@/components/atoms/fields";
import { StatusBadge } from "@/components/atoms/status-badge";
import { DataTable, Pagination } from "@/components/molecules/data-table";
import { MoneyInput } from "@/components/molecules/money-input";
import { EmptyState, ErrorState, LoadingState } from "@/components/molecules/states";
import { useSession } from "@/components/session-context";
import { useToast } from "@/hooks/use-console";
import { api } from "@/lib/api";
import { describeError } from "@/lib/api-error";
import { newIdempotencyKey } from "@/lib/idempotency";
import { formatMinor } from "@/lib/money";
import { Permission, can } from "@/lib/permissions";
import { PAYMENT_STATUSES } from "@/lib/workflows";
import { paymentFiltersAtom } from "@/state/atoms";

const CreateSchema = z.object({
  merchantId: z.uuid(),
  amountMinor: z.string().regex(/^[1-9]\d*$/, "Enter a positive integer in minor units."),
  currency: z.string().length(3),
});

type CreateValues = z.infer<typeof CreateSchema>;

interface PaymentSummary {
  id: string;
  merchantId: string;
  status: string;
  currency: string;
  amountMinor: string;
  createdAt: string;
}

export function PaymentsPage() {
  const session = useSession();
  const allowed = can(session.permissions, Permission.PAYMENTS_READ);
  const [filters, setFilters] = useAtom(paymentFiltersAtom);
  const [drawer, setDrawer] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const query = useQuery({
    queryKey: ["payments", filters],
    enabled: allowed,
    queryFn: () => {
      const params = new URLSearchParams({
        limit: String(filters.limit),
        offset: String(filters.offset),
      });
      if (filters.status !== "") params.set("status", filters.status);
      return api<{ payments: PaymentSummary[] }>("payment", `payments?${params.toString()}`);
    },
  });

  if (!allowed) {
    return (
      <ErrorState
        title="Payments are not available"
        body="This principal does not have payments.read. The payment service enforces the same check."
      />
    );
  }

  const loaded = query.data?.payments ?? [];
  const rows = loaded.filter((payment) => {
    const day = payment.createdAt.slice(0, 10);
    if (from !== "" && day < from) return false;
    if (to !== "" && day > to) return false;
    return true;
  });

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Payments</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Amounts are integer minor units. A timeout is not a success and is not retried automatically.
          </p>
        </div>
        {can(session.permissions, Permission.PAYMENTS_CREATE) ? (
          <Button type="button" onClick={() => setDrawer(true)}>
            Create payment
          </Button>
        ) : null}
      </header>
      <div className="flex flex-wrap gap-3">
        <Field label="Status" htmlFor="status-filter">
          <Select
            id="status-filter"
            value={filters.status}
            onChange={(event) => setFilters({ ...filters, status: event.target.value, offset: 0 })}
          >
            <option value="">All statuses</option>
            {PAYMENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="From" hint="Filters this page by created date." htmlFor="from-date">
          <Input id="from-date" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </Field>
        <Field label="To" htmlFor="to-date">
          <Input id="to-date" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </Field>
        <Field label="Page size" htmlFor="page-size">
          <Select
            id="page-size"
            value={String(filters.limit)}
            onChange={(event) =>
              setFilters({ ...filters, limit: Number(event.target.value), offset: 0 })
            }
          >
            <option value="25">25</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </Select>
        </Field>
      </div>
      {query.isLoading ? <LoadingState label="Loading payments…" /> : null}
      {query.isError ? <ErrorState title="Could not load payments" body={describeError(query.error)} /> : null}
      {!query.isLoading && rows.length === 0 ? (
        <EmptyState title="No payments on this page" body="Change the status filter or create a payment." />
      ) : null}
      {rows.length > 0 ? (
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
            { key: "merchant", header: "Merchant", render: (row) => <span className="font-mono text-xs">{row.merchantId}</span> },
            { key: "created", header: "Created", render: (row) => row.createdAt },
          ]}
        />
      ) : null}
      <Pagination
        offset={filters.offset}
        limit={filters.limit}
        count={loaded.length}
        onChange={(offset) => setFilters({ ...filters, offset })}
      />
      {drawer ? <CreateDrawer onClose={() => setDrawer(false)} /> : null}
    </div>
  );
}

function CreateDrawer({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const client = useQueryClient();
  const toast = useToast();
  const form = useForm<CreateValues>({
    resolver: zodResolver(CreateSchema),
    defaultValues: { merchantId: "", amountMinor: "", currency: "INR" },
  });
  const currency = form.watch("currency");

  async function onSubmit(values: CreateValues) {
    const key = newIdempotencyKey();
    try {
      const created = await api<{ id: string }>("payment", "payments", {
        method: "POST",
        idempotencyKey: key,
        body: values,
      });
      await client.invalidateQueries({ queryKey: ["payments"] });
      toast({ tone: "ok", text: "Payment created. It is not authorized yet." });
      router.push(`/payments/${created.id}`);
    } catch (error) {
      toast({ tone: "danger", text: describeError(error) });
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex justify-end bg-ink/30">
      <div role="dialog" aria-modal="true" aria-labelledby="create-payment-title" className="h-full w-full max-w-md overflow-y-auto bg-panel p-6 shadow-xl">
        <h2 id="create-payment-title" className="text-lg font-semibold">
          Create payment
        </h2>
        <p className="mt-1 text-sm text-ink-soft">This records a payment. It does not authorize or capture it.</p>
        <form className="mt-4 space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
          <Field label="Merchant id" htmlFor="merchantId">
            <Input id="merchantId" {...form.register("merchantId")} />
          </Field>
          <Field label="Amount in minor units" htmlFor="amountMinor" hint={`10000 ${currency} minor units is ${formatMinor("10000", currency)}.`}>
            <MoneyInput
              id="amountMinor"
              currency={currency}
              value={form.watch("amountMinor")}
              onChange={(value) => form.setValue("amountMinor", value, { shouldValidate: true })}
            />
          </Field>
          <Field label="Currency" htmlFor="currency">
            <Select id="currency" {...form.register("currency")}>
              <option value="INR">INR</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
            </Select>
          </Field>
          {form.formState.errors.amountMinor ? (
            <p className="text-sm text-danger">{form.formState.errors.amountMinor.message}</p>
          ) : null}
          {form.formState.errors.merchantId ? (
            <p className="text-sm text-danger">{form.formState.errors.merchantId.message}</p>
          ) : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={form.formState.isSubmitting}>
              Create
            </Button>
            <Button type="button" variant="quiet" onClick={onClose}>
              Close
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
