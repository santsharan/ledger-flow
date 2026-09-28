"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/atoms/button";
import { Field, Input } from "@/components/atoms/fields";
import { ErrorState } from "@/components/molecules/states";
import { useSession } from "@/components/session-context";
import { useToast } from "@/hooks/use-console";
import { api } from "@/lib/api";
import { describeError } from "@/lib/api-error";
import { Permission, can } from "@/lib/permissions";

const ROLES = [
  "MERCHANT_ADMIN",
  "MERCHANT_OPERATOR",
  "FINANCE_OPERATOR",
  "RISK_ANALYST",
  "RECONCILIATION_OPERATOR",
  "SUPPORT",
  "PLATFORM_ADMIN",
] as const;

const Schema = z.object({
  email: z.email(),
  password: z.string().min(12),
  fullName: z.string().min(1),
  merchantId: z.string(),
});

export function AdminPage() {
  const session = useSession();
  const toast = useToast();
  const [roles, setRoles] = useState<string[]>(["SUPPORT"]);
  const [lookup, setLookup] = useState("");
  const [found, setFound] = useState<string | null>(null);
  const form = useForm<z.infer<typeof Schema>>({
    resolver: zodResolver(Schema),
    defaultValues: { email: "", password: "", fullName: "", merchantId: "" },
  });

  if (!can(session.permissions, Permission.USERS_READ)) {
    return <ErrorState title="Admin is hidden" body="users.read is required. Creating a user also needs users.write." />;
  }

  async function create(values: z.infer<typeof Schema>) {
    if (!can(session.permissions, Permission.USERS_WRITE)) {
      toast({ tone: "danger", text: "users.write is required to create a user." });
      return;
    }
    try {
      await api("identity", "users", {
        method: "POST",
        body: {
          email: values.email,
          password: values.password,
          fullName: values.fullName,
          roles,
          ...(values.merchantId === "" ? {} : { merchantId: values.merchantId }),
        },
      });
      toast({ tone: "ok", text: "User created. The password was not stored in this browser." });
      form.reset();
    } catch (error) {
      toast({ tone: "danger", text: describeError(error) });
    }
  }

  async function loadUser() {
    try {
      const user = await api<{ email: string; roles: string[] }>("identity", `users/${lookup}`);
      setFound(`${user.email} · ${user.roles.join(", ")}`);
    } catch (error) {
      setFound(null);
      toast({ tone: "danger", text: describeError(error) });
    }
  }

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <p className="text-sm text-ink-soft">
        There is no list-users endpoint. Look up a user by id. Roles are bundles; the services still check permissions.
      </p>
      <div className="flex items-end gap-2">
        <Field label="User id" htmlFor="user-id">
          <Input id="user-id" value={lookup} onChange={(event) => setLookup(event.target.value)} />
        </Field>
        <Button type="button" variant="quiet" onClick={loadUser}>
          Look up
        </Button>
      </div>
      {found ? <p className="text-sm">{found}</p> : null}
      {can(session.permissions, Permission.USERS_WRITE) ? (
        <form className="space-y-3" onSubmit={form.handleSubmit(create)}>
          <h2 className="text-lg font-medium">Create user</h2>
          <Field label="Name" htmlFor="fullName">
            <Input id="fullName" {...form.register("fullName")} />
          </Field>
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" {...form.register("email")} />
          </Field>
          <Field label="Password" htmlFor="password">
            <Input id="password" type="password" autoComplete="new-password" {...form.register("password")} />
          </Field>
          <Field label="Merchant id" hint="Required for merchant roles." htmlFor="merchantId">
            <Input id="merchantId" {...form.register("merchantId")} />
          </Field>
          <fieldset>
            <legend className="text-sm font-medium">Roles</legend>
            <div className="mt-2 space-y-1">
              {ROLES.map((role) => (
                <label key={role} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={roles.includes(role)}
                    onChange={(event) =>
                      setRoles((current) =>
                        event.target.checked ? [...current, role] : current.filter((item) => item !== role),
                      )
                    }
                  />
                  {role}
                </label>
              ))}
            </div>
          </fieldset>
          <Button type="submit">Create user</Button>
        </form>
      ) : null}
    </div>
  );
}
