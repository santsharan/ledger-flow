import { redirect } from "next/navigation";
import { ConsoleShell } from "@/components/layouts/console-shell";
import { Providers } from "@/components/providers";
import { readSession } from "@/lib/identity";
import { ACCESS_COOKIE } from "@/lib/session";
import { cookies } from "next/headers";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await readSession();
  if (session.user === null) {
    const jar = await cookies();
    if (jar.get(ACCESS_COOKIE) !== undefined) {
      return (
        <main className="mx-auto max-w-lg px-6 py-24">
          <h1 className="text-2xl font-semibold">Identity is unavailable</h1>
          <p className="mt-2 text-sm text-ink-soft">
            A session cookie is present, but the identity service did not return a profile. No financial
            action can run until that check succeeds.
          </p>
        </main>
      );
    }
    redirect("/login");
  }

  return (
    <Providers>
      <ConsoleShell user={session.user}>{children}</ConsoleShell>
    </Providers>
  );
}
