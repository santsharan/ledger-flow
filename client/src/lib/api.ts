import { ApiError } from "./api-error";
import { type ServiceName } from "./services";

export async function api<T>(
  service: ServiceName,
  path: string,
  init: { method?: string; body?: unknown; idempotencyKey?: string } = {},
): Promise<T> {
  const headers = new Headers();
  if (init.body !== undefined) headers.set("content-type", "application/json");
  if (init.idempotencyKey !== undefined) headers.set("idempotency-key", init.idempotencyKey);
  const response = await fetch(`/api/backend/${service}/${path.replace(/^\//, "")}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: "same-origin",
  });
  if (response.status === 204) return undefined as T;
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined") {
      window.location.assign("/login");
    }
    throw new ApiError(response.status, payload);
  }
  return payload as T;
}
