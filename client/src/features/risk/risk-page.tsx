"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/atoms/button";
import { Field, Input, Select } from "@/components/atoms/fields";
import { StatusBadge } from "@/components/atoms/status-badge";
import { ErrorState } from "@/components/molecules/states";
import { useSession } from "@/components/session-context";
import { useToast } from "@/hooks/use-console";
import { api } from "@/lib/api";
import { describeError } from "@/lib/api-error";
import { Permission, can } from "@/lib/permissions";

const Schema = z.object({
  amountMinor: z.string().regex(/^\d+$/),
  currency: z.string().length(3),
  merchantAgeDays: z.number().int().min(0),
  merchantRecentCount: z.number().int().min(0),
  customerRecentCount: z.number().int().min(0),
  historicalTransactionCount: z.number().int().min(0),
  failedAttempts: z.number().int().min(0),
  country: z.string().length(2),
  ipRisk: z.enum(["LOW", "MEDIUM", "HIGH"]),
  deviceRisk: z.enum(["LOW", "MEDIUM", "HIGH"]),
});

type Values = z.infer<typeof Schema>;

interface Decision {
  id: string;
  decision: string;
  riskScore: number;
  reasonCodes: string[];
  engine: string;
}

export function RiskPage() {
  const session = useSession();
  const toast = useToast();
  const [decision, setDecision] = useState<Decision | null>(null);
  const form = useForm<Values>({
    defaultValues: {
      amountMinor: "100000",
      currency: "INR",
      merchantAgeDays: 400,
      merchantRecentCount: 1,
      customerRecentCount: 1,
      historicalTransactionCount: 20,
      failedAttempts: 0,
      country: "IN",
      ipRisk: "LOW",
      deviceRisk: "LOW",
    },
  });

  if (!can(session.permissions, Permission.RISK_READ)) {
    return <ErrorState title="Risk is hidden" body="risk.read is required to evaluate a payment." />;
  }

  async function onSubmit(values: Values) {
    const parsed = Schema.safeParse(values);
    if (!parsed.success) {
      toast({ tone: "danger", text: "Check the risk inputs. Counts must be whole numbers." });
      return;
    }
    try {
      const stored = await api<Decision>("risk", "risk/evaluations", { method: "POST", body: parsed.data });
      setDecision(stored);
      toast({ tone: "ok", text: "Decision stored. It cannot be edited." });
    } catch (error) {
      toast({ tone: "danger", text: describeError(error) });
    }
  }

  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold">Risk</h1>
      <p className="text-sm text-ink-soft">
        The rules engine returns ALLOW, REVIEW, or DECLINE. There is no override endpoint, so risk.override cannot
        change a stored decision from this console.
      </p>
      <form className="space-y-3" onSubmit={form.handleSubmit(onSubmit)}>
        <Field label="Amount minor" htmlFor="amountMinor">
          <Input id="amountMinor" {...form.register("amountMinor")} />
        </Field>
        <Field label="Currency" htmlFor="currency">
          <Input id="currency" {...form.register("currency")} />
        </Field>
        <Field label="Country" htmlFor="country">
          <Input id="country" maxLength={2} {...form.register("country")} />
        </Field>
        <Field label="Merchant age days" htmlFor="merchantAgeDays">
          <Input id="merchantAgeDays" type="number" {...form.register("merchantAgeDays", { valueAsNumber: true })} />
        </Field>
        <Field label="Failed attempts" htmlFor="failedAttempts">
          <Input id="failedAttempts" type="number" {...form.register("failedAttempts", { valueAsNumber: true })} />
        </Field>
        <Field label="IP risk" htmlFor="ipRisk">
          <Select id="ipRisk" {...form.register("ipRisk")}>
            <option>LOW</option>
            <option>MEDIUM</option>
            <option>HIGH</option>
          </Select>
        </Field>
        <Field label="Device risk" htmlFor="deviceRisk">
          <Select id="deviceRisk" {...form.register("deviceRisk")}>
            <option>LOW</option>
            <option>MEDIUM</option>
            <option>HIGH</option>
          </Select>
        </Field>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          Evaluate
        </Button>
      </form>
      {decision ? (
        <div className="rounded-lg border border-line bg-panel p-4">
          <StatusBadge status={decision.decision} />
          <p className="mt-2 font-mono text-sm">Score {decision.riskScore}</p>
          <p className="text-sm">{decision.reasonCodes.join(", ") || "No reason codes"}</p>
          <p className="font-mono text-xs text-ink-soft">
            {decision.engine} · {decision.id}
          </p>
        </div>
      ) : null}
    </div>
  );
}
