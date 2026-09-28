"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { useEffect, useState } from "react";
import { Button } from "@/components/atoms/button";
import { Field } from "@/components/atoms/fields";
import { StatusBadge } from "@/components/atoms/status-badge";
import { MoneyInput } from "@/components/molecules/money-input";
import { ErrorState, LoadingState } from "@/components/molecules/states";
import { useSession } from "@/components/session-context";
import { useConfirm, useToast } from "@/hooks/use-console";
import { api } from "@/lib/api";
import { describeError, isApiError } from "@/lib/api-error";
import { newIdempotencyKey } from "@/lib/idempotency";
import { formatMinor } from "@/lib/money";
import { Permission, can } from "@/lib/permissions";
import { selectedPaymentIdAtom } from "@/state/atoms";

interface PaymentView {
  id: string;
  merchantId: string;
  status: string;
  currency: string;
  amountMinor: string;
  authorizedMinor: string;
  capturedMinor: string;
  refundedMinor: string;
  attempts: {
    id: string;
    attemptNumber: number;
    operation: string;
    status: string;
    amountMinor: string;
    currency: string;
    providerReference: string | null;
    failureCode: string | null;
  }[];
  ledgerPostings: {
    referenceType: string;
    referenceId: string;
    amountMinor: string;
    status: string;
    journalId: string | null;
  }[];
}

export function PaymentDetail({ paymentId }: { paymentId: string }) {
  const session = useSession();
  const setSelected = useSetAtom(selectedPaymentIdAtom);
  const confirm = useConfirm();
  const toast = useToast();
  const client = useQueryClient();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const allowed = can(session.permissions, Permission.PAYMENTS_READ);

  useEffect(() => {
    setSelected(paymentId);
  }, [paymentId, setSelected]);

  const query = useQuery({
    queryKey: ["payment", paymentId],
    enabled: allowed,
    queryFn: () => api<PaymentView>("payment", `payments/${paymentId}`),
  });

  if (!allowed) {
    return <ErrorState title="Not permitted" body="payments.read is required to open a payment." />;
  }
  if (query.isLoading) return <LoadingState label="Loading payment…" />;
  if (query.isError || query.data === undefined) {
    return <ErrorState title="Payment unavailable" body={describeError(query.error)} />;
  }

  const payment = query.data;
  const unknown = payment.status.endsWith("_UNKNOWN");

  async function command(path: string, label: string, body: unknown, permission: string) {
    if (!can(session.permissions, permission)) {
      toast({ tone: "danger", text: `This action requires ${permission}.` });
      return;
    }
    const key = pendingKey ?? newIdempotencyKey();
    const accepted = await confirm({
      title: label,
      danger: label === "Refund",
      confirmLabel: label,
      body: `${label} ${formatMinor(payment.amountMinor, payment.currency)}.\nIdempotency key ${key}.\nThe console will not send this again unless you confirm a second time after an unknown outcome.`,
    });
    if (!accepted) return;
    setPendingKey(key);
    try {
      await api("payment", path, { method: "POST", body, idempotencyKey: key });
      setPendingKey(null);
      await client.invalidateQueries({ queryKey: ["payment", paymentId] });
      toast({ tone: "ok", text: `${label} was accepted. The status below is the service response.` });
    } catch (error) {
      const uncertain = !isApiError(error) || error.status >= 500;
      toast({
        tone: "danger",
        text: uncertain
          ? `${describeError(error)} Keep key ${key} and submit the same action again only if you mean to replay it.`
          : describeError(error),
      });
      if (!uncertain) setPendingKey(null);
      await client.invalidateQueries({ queryKey: ["payment", paymentId] });
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-ink-soft">{payment.id}</p>
          <h1 className="mt-1 text-2xl font-semibold">Payment</h1>
          <div className="mt-2">
            <StatusBadge status={payment.status} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {payment.status === "CREATED" && can(session.permissions, Permission.PAYMENTS_CREATE) ? (
            <Button type="button" onClick={() => command(`payments/${payment.id}/authorize`, "Authorize", {}, Permission.PAYMENTS_CREATE)}>
              Authorize
            </Button>
          ) : null}
          {payment.status === "AUTHORIZED" && can(session.permissions, Permission.PAYMENTS_CAPTURE) ? (
            <Button
              type="button"
              onClick={() => command(`payments/${payment.id}/capture`, "Capture", {}, Permission.PAYMENTS_CAPTURE)}
            >
              Capture
            </Button>
          ) : null}
          {(payment.status === "CAPTURED" || payment.status === "PARTIALLY_REFUNDED") &&
          can(session.permissions, Permission.PAYMENTS_REFUND) ? (
            <Button
              type="button"
              variant="danger"
              onClick={() =>
                command(
                  `payments/${payment.id}/refund`,
                  "Refund",
                  refundAmount === "" ? {} : { amountMinor: refundAmount },
                  Permission.PAYMENTS_REFUND,
                )
              }
            >
              Refund
            </Button>
          ) : null}
          {unknown && can(session.permissions, Permission.PAYMENTS_CAPTURE) ? (
            <Button type="button" variant="quiet" onClick={() => command(`payments/${payment.id}/resolve`, "Resolve", {}, Permission.PAYMENTS_CAPTURE)}>
              Resolve unknown
            </Button>
          ) : null}
          {payment.ledgerPostings.some((posting) => posting.status === "PENDING") &&
          can(session.permissions, Permission.PAYMENTS_CAPTURE) ? (
            <Button
              type="button"
              variant="quiet"
              onClick={() =>
                command(`payments/${payment.id}/ledger-postings`, "Post ledger", {}, Permission.PAYMENTS_CAPTURE)
              }
            >
              Post pending ledger
            </Button>
          ) : null}
        </div>
      </header>
      {unknown ? (
        <ErrorState
          title="Provider outcome is unknown"
          body="Do not authorize, capture, or refund again. Resolve asks the provider about the same attempt."
        />
      ) : null}
      {payment.status.endsWith("_PENDING") ? (
        <p className="text-sm text-ink-soft">This operation is in progress. Wait for a terminal status.</p>
      ) : null}
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Amount label="Requested" amount={payment.amountMinor} currency={payment.currency} />
        <Amount label="Authorized" amount={payment.authorizedMinor} currency={payment.currency} />
        <Amount label="Captured" amount={payment.capturedMinor} currency={payment.currency} />
        <Amount label="Refunded" amount={payment.refundedMinor} currency={payment.currency} />
      </dl>
      {(payment.status === "CAPTURED" || payment.status === "PARTIALLY_REFUNDED") &&
      can(session.permissions, Permission.PAYMENTS_REFUND) ? (
        <Field label="Refund amount in minor units" hint="Leave empty to refund the remaining captured amount." htmlFor="refund-amount">
          <MoneyInput id="refund-amount" currency={payment.currency} value={refundAmount} onChange={setRefundAmount} />
        </Field>
      ) : null}
      <section className="space-y-2">
        <h2 className="text-lg font-medium">Attempts</h2>
        <ol className="space-y-2 border-l border-line pl-4">
          {payment.attempts.map((attempt) => (
            <li key={attempt.id}>
              <p className="text-sm">
                #{attempt.attemptNumber} {attempt.operation} · <StatusBadge status={attempt.status} />
              </p>
              <p className="font-mono text-xs text-ink-soft">
                {formatMinor(attempt.amountMinor, attempt.currency)}
                {attempt.providerReference ? ` · provider ${attempt.providerReference}` : ""}
                {attempt.failureCode ? ` · ${attempt.failureCode}` : ""}
              </p>
            </li>
          ))}
        </ol>
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-medium">Ledger postings</h2>
        {payment.ledgerPostings.length === 0 ? (
          <p className="text-sm text-ink-soft">No ledger posting has been requested.</p>
        ) : (
          <ul className="space-y-2">
            {payment.ledgerPostings.map((posting) => (
              <li key={posting.referenceId} className="rounded-md border border-line bg-panel px-3 py-2 text-sm">
                <StatusBadge status={posting.status} />{" "}
                <span className="font-mono">{formatMinor(posting.amountMinor, payment.currency)}</span>
                <p className="mt-1 font-mono text-xs text-ink-soft">
                  {posting.referenceType} {posting.referenceId}
                </p>
                {posting.journalId ? (
                  <Link className="text-accent underline" href={`/ledger/journals/${posting.journalId}`}>
                    Open journal
                  </Link>
                ) : (
                  <p className="text-xs text-warning">Journal is not posted yet.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-sm">
        <Link className="text-accent underline" href={`/audit?resourceId=${payment.id}`}>
          Audit for this payment
        </Link>
      </p>
      <p className="font-mono text-xs text-ink-soft">Merchant {payment.merchantId}</p>
    </div>
  );
}

function Amount({ label, amount, currency }: { label: string; amount: string; currency: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel px-3 py-2">
      <dt className="text-xs uppercase tracking-wide text-ink-soft">{label}</dt>
      <dd className="font-mono text-lg">{formatMinor(amount, currency)}</dd>
    </div>
  );
}
