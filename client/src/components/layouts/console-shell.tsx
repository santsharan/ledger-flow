"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAtom } from "jotai";
import { FormEvent, useState, type ReactNode } from "react";
import { ConfirmHost, ToastRegion } from "@/components/molecules/overlays";
import { SessionProvider } from "@/components/session-context";
import { visibleNav } from "@/lib/permissions";
import type { SessionUser } from "@/lib/session";
import { sidebarOpenAtom } from "@/state/atoms";

export function ConsoleShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useAtom(sidebarOpenAtom);
  const [query, setQuery] = useState("");
  const items = visibleNav(user.permissions);

  async function logout() {
    await fetch("/api/session/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  function search(event: FormEvent) {
    event.preventDefault();
    const value = query.trim();
    if (value.length === 0) return;
    router.push(`/search?q=${encodeURIComponent(value)}`);
  }

  return (
    <SessionProvider user={user}>
      <div className="min-h-screen bg-paper text-ink">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-panel focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        <div className="flex min-h-screen">
          <aside
            className={`${open ? "w-60" : "w-0 overflow-hidden"} shrink-0 border-r border-white/10 bg-ink text-paper md:w-60`}
          >
            <div className="px-4 py-5">
              <p className="font-mono text-xs tracking-[0.2em] text-paper/60">LEDGERFLOW</p>
              <p className="mt-1 text-sm">Operations console</p>
            </div>
            <nav aria-label="Primary" className="px-2 pb-6">
              {items.map((item) => {
                const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`mb-1 block rounded-md px-3 py-2 text-sm ${
                      active ? "bg-white/10 text-white" : "text-paper/80 hover:bg-white/5"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex items-center gap-3 border-b border-line bg-panel px-4 py-3">
              <button
                type="button"
                className="rounded border border-line px-2 py-1 text-sm md:hidden"
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
              >
                Menu
              </button>
              <form onSubmit={search} className="flex flex-1 gap-2" role="search">
                <label className="sr-only" htmlFor="global-search">
                  Search by identifier
                </label>
                <input
                  id="global-search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Payment, journal, settlement, merchant, or case id"
                  className="w-full rounded-md border border-line bg-paper px-3 py-2 text-sm"
                />
                <button type="submit" className="rounded-md border border-line px-3 text-sm">
                  Open
                </button>
              </form>
              <div className="hidden text-right text-sm sm:block">
                <p className="font-medium">{user.fullName}</p>
                <p className="text-xs text-ink-soft">{user.roles.join(", ") || "No roles"}</p>
              </div>
              <button type="button" className="rounded-md border border-line px-3 py-2 text-sm" onClick={logout}>
                Sign out
              </button>
            </header>
            <main id="main" className="flex-1 px-4 py-6 md:px-8">
              {children}
            </main>
          </div>
        </div>
        <ConfirmHost />
        <ToastRegion />
      </div>
    </SessionProvider>
  );
}
