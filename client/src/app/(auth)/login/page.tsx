"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/atoms/button";
import { Field, Input } from "@/components/atoms/fields";
import { ApiError } from "@/lib/api-error";

const LoginSchema = z.object({
  email: z.email("Enter a valid email."),
  password: z.string().min(12, "Password must be at least 12 characters."),
});

type LoginValues = z.infer<typeof LoginSchema>;

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(LoginSchema) });

  async function onSubmit(values: LoginValues) {
    setFormError(null);
    const response = await fetch("/api/session/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new ApiError(response.status, payload);
      setFormError(error.message);
      return;
    }
    const next = params.get("next");
    router.replace(next !== null && next.startsWith("/") ? next : "/");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <Field label="Email" htmlFor="email">
        <Input id="email" type="email" autoComplete="username" {...register("email")} />
      </Field>
      {errors.email ? <p className="text-sm text-danger">{errors.email.message}</p> : null}
      <Field label="Password" htmlFor="password" hint="At least 12 characters. It is sent only to identity and is not stored in the browser.">
        <Input id="password" type="password" autoComplete="current-password" {...register("password")} />
      </Field>
      {errors.password ? <p className="text-sm text-danger">{errors.password.message}</p> : null}
      {formError ? (
        <p role="alert" className="text-sm text-danger">
          {formError}
        </p>
      ) : null}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="grid min-h-screen bg-paper md:grid-cols-2">
      <section className="hidden flex-col justify-between bg-ink px-10 py-12 text-paper md:flex">
        <div>
          <p className="font-mono text-xs tracking-[0.22em] text-paper/60">LEDGERFLOW</p>
          <h1 className="mt-6 max-w-md text-3xl font-semibold leading-tight">
            Payments, journals, settlement, and the differences between them.
          </h1>
        </div>
        <ol className="max-w-sm space-y-2 text-sm text-paper/80">
          <li>1. Capture moves money only after the service confirms it.</li>
          <li>2. A lost acquirer response stays UNKNOWN until it is resolved.</li>
          <li>3. Posted journals are corrected by reversal, never by editing.</li>
        </ol>
      </section>
      <section className="flex items-center px-6 py-16">
        <div className="mx-auto w-full max-w-sm">
          <h2 className="text-2xl font-semibold">Sign in</h2>
          <p className="mt-1 mb-6 text-sm text-ink-soft">Operator access. Tokens stay in HttpOnly cookies.</p>
          <Suspense fallback={<p className="text-sm text-ink-soft">Loading the form…</p>}>
            <LoginForm />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
