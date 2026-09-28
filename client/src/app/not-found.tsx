import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-lg px-6 py-24">
      <p className="font-mono text-xs tracking-[0.2em] text-ink-soft">404</p>
      <h1 className="mt-2 text-2xl font-semibold">This page is not in the console.</h1>
      <p className="mt-2 text-sm text-ink-soft">The identifier or route does not match a LedgerFlow screen.</p>
      <Link href="/" className="mt-6 inline-block text-sm text-accent underline">
        Back to the dashboard
      </Link>
    </main>
  );
}
