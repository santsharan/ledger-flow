"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/atoms/button";
import { Field, Input, Select } from "@/components/atoms/fields";
import { StatusBadge } from "@/components/atoms/status-badge";
import { DataTable } from "@/components/molecules/data-table";
import { EmptyState, ErrorState, LoadingState } from "@/components/molecules/states";
import { useSession } from "@/components/session-context";
import { useConfirm, useToast } from "@/hooks/use-console";
import { api } from "@/lib/api";
import { describeError } from "@/lib/api-error";
import { Permission, can } from "@/lib/permissions";

const CreateSchema = z.object({
  legalName: z.string().min(1),
  displayName: z.string().min(1),
  country: z.string().length(2),
  contactEmail: z.email(),
  settlementCurrency: z.string().length(3),
});

interface Merchant {
  id: string;
  legalName: string;
  displayName: string;
  country: string;
  status: string;
  settlementCurrency: string;
}

export function MerchantsPage() {
  const session = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const client = useQueryClient();
  const [reason, setReason] = useState("");
  const query = useQuery({
    queryKey: ["merchants"],
    enabled: can(session.permissions, Permission.MERCHANTS_READ),
    queryFn: () => api<{ merchants: Merchant[] }>("merchant", "merchants?limit=50"),
  });
  const form = useForm<z.infer<typeof CreateSchema>>({
    resolver: zodResolver(CreateSchema),
    defaultValues: {
      legalName: "",
      displayName: "",
      country: "IN",
      contactEmail: "",
      settlementCurrency: "INR",
    },
  });

  if (!can(session.permissions, Permission.MERCHANTS_READ)) {
    return <ErrorState title="Merchants are hidden" body="merchants.read is required." />;
  }

  async function create(values: z.infer<typeof CreateSchema>) {
    try {
      await api("merchant", "merchants", { method: "POST", body: values });
      await client.invalidateQueries({ queryKey: ["merchants"] });
      toast({ tone: "ok", text: "Merchant onboarded. Activate it before it can take payments." });
      form.reset();
    } catch (error) {
      toast({ tone: "danger", text: describeError(error) });
    }
  }

  async function change(id: string, action: "activate" | "suspend" | "close") {
    if (reason.trim().length < 3) {
      toast({ tone: "danger", text: "Enter a reason of at least 3 characters before changing status." });
      return;
    }
    const accepted = await confirm({
      title: `${action} merchant`,
      confirmLabel: action,
      danger: action !== "activate",
      body: reason,
    });
    if (!accepted) return;
    try {
      await api("merchant", `merchants/${id}/${action}`, { method: "POST", body: { reason } });
      await client.invalidateQueries({ queryKey: ["merchants"] });
    } catch (error) {
      toast({ tone: "danger", text: describeError(error) });
    }
  }

  const rows = query.data?.merchants ?? [];
  const writable = can(session.permissions, Permission.MERCHANTS_WRITE);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Merchants</h1>
      {query.isLoading ? <LoadingState label="Loading merchants…" /> : null}
      {query.isError ? <ErrorState title="Merchants unavailable" body={describeError(query.error)} /> : null}
      {rows.length === 0 && !query.isLoading ? <EmptyState title="No merchants" body="Onboard one to attach payments and settlements." /> : null}
      <Field label="Status-change reason" htmlFor="merchant-reason">
        <Input id="merchant-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
      </Field>
      {rows.length > 0 ? (
        <DataTable<Merchant>
          rows={rows}
          rowKey={(row) => row.id}
          columns={[
            { key: "name", header: "Name", render: (row) => row.displayName },
            { key: "status", header: "Status", render: (row) => <StatusBadge status={row.status} /> },
            { key: "country", header: "Country", render: (row) => row.country },
            {
              key: "id",
              header: "Id",
              render: (row) => <span className="font-mono text-xs">{row.id}</span>,
            },
            {
              key: "actions",
              header: "Actions",
              render: (row) =>
                writable ? (
                  <span className="flex gap-2">
                    <button type="button" className="text-accent underline" onClick={() => change(row.id, "activate")}>
                      Activate
                    </button>
                    <button type="button" className="text-accent underline" onClick={() => change(row.id, "suspend")}>
                      Suspend
                    </button>
                  </span>
                ) : (
                  "—"
                ),
            },
          ]}
        />
      ) : null}
      {writable ? (
        <form className="max-w-lg space-y-3" onSubmit={form.handleSubmit(create)}>
          <h2 className="text-lg font-medium">Onboard</h2>
          <Field label="Legal name" htmlFor="legalName">
            <Input id="legalName" {...form.register("legalName")} />
          </Field>
          <Field label="Display name" htmlFor="displayName">
            <Input id="displayName" {...form.register("displayName")} />
          </Field>
          <Field label="Contact email" htmlFor="contactEmail">
            <Input id="contactEmail" {...form.register("contactEmail")} />
          </Field>
          <Field label="Country" htmlFor="country">
            <Input id="country" maxLength={2} {...form.register("country")} />
          </Field>
          <Field label="Settlement currency" htmlFor="settlementCurrency">
            <Select id="settlementCurrency" {...form.register("settlementCurrency")}>
              <option value="INR">INR</option>
              <option value="USD">USD</option>
            </Select>
          </Field>
          <Button type="submit">Onboard</Button>
        </form>
      ) : null}
    </div>
  );
}
