"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ErrorState, LoadingState } from "@/components/molecules/states";
import { api } from "@/lib/api";
import { isApiError } from "@/lib/api-error";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function SearchBody() {
  const params = useSearchParams();
  const query = params.get("q")?.trim() ?? "";
  const [hits, setHits] = useState<{ href: string; label: string }[]>([]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setDone(false);
      if (!UUID.test(query)) {
        setHits([]);
        setDone(true);
        return;
      }
      const checks: { href: string; label: string; load: () => Promise<unknown> }[] = [
        { href: `/payments/${query}`, label: "Payment", load: () => api("payment", `payments/${query}`) },
        { href: `/ledger/journals/${query}`, label: "Journal", load: () => api("ledger", `journals/${query}`) },
        { href: `/ledger/accounts/${query}`, label: "Account", load: () => api("ledger", `accounts/${query}`) },
        { href: `/settlements/${query}`, label: "Settlement", load: () => api("settlement", `settlements/${query}`) },
        { href: `/reconciliation/${query}`, label: "Case", load: () => api("reconciliation", `reconciliation/cases/${query}`) },
        { href: `/merchants`, label: "Merchant", load: () => api("merchant", `merchants/${query}`) },
      ];
      const found: { href: string; label: string }[] = [];
      for (const check of checks) {
        try {
          await check.load();
          found.push({ href: check.href, label: check.label });
        } catch (error) {
          if (isApiError(error) && (error.status === 403 || error.status === 401)) {
            found.push({ href: check.href, label: `${check.label} (not permitted or hidden)` });
          }
        }
      }
      if (!cancelled) {
        setHits(found);
        setDone(true);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [query]);

  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-semibold">Search</h1>
      <p className="text-sm text-ink-soft">Search opens a record by its id. It does not scan free text.</p>
      {!done ? <LoadingState label="Looking up the identifier…" /> : null}
      {done && !UUID.test(query) ? (
        <ErrorState title="Not an identifier" body="Paste a UUID from a payment, journal, account, settlement, merchant, or case." />
      ) : null}
      {done && UUID.test(query) && hits.length === 0 ? (
        <ErrorState title="No record" body="None of the services returned this id for your permissions." />
      ) : null}
      <ul className="space-y-2">
        {hits.map((hit) => (
          <li key={hit.href + hit.label}>
            <Link className="text-accent underline" href={hit.href}>
              {hit.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SearchPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading search…" />}>
      <SearchBody />
    </Suspense>
  );
}
