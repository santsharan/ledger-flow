import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { refreshTokens } from "@/lib/identity";
import { isServiceName, serviceBaseUrl, type ServiceName } from "@/lib/services";
import { ACCESS_COOKIE, REFRESH_COOKIE, cookieOptions } from "@/lib/session";

interface RouteContext {
  params: Promise<{ service: string; path: string[] }>;
}

async function proxy(request: Request, context: RouteContext): Promise<NextResponse> {
  const { service, path } = await context.params;
  if (!isServiceName(service)) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Unknown service.", requestId: null } },
      { status: 404 },
    );
  }

  const jar = await cookies();
  let access = jar.get(ACCESS_COOKIE)?.value;
  if (access === undefined) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Sign in required.", requestId: null } },
      { status: 401 },
    );
  }

  const target = buildTarget(service, path, request.url);
  const body =
    request.method === "GET" || request.method === "HEAD" ? undefined : await request.text();
  let upstream = await callUpstream(request, target, access, body);
  let refreshed: Awaited<ReturnType<typeof refreshTokens>> = null;
  if (upstream.status === 401) {
    const refresh = jar.get(REFRESH_COOKIE)?.value;
    refreshed = refresh === undefined ? null : await refreshTokens(refresh);
    if (refreshed !== null) {
      access = refreshed.accessToken;
      upstream = await callUpstream(request, target, access, body);
    }
  }

  const response = await toResponse(upstream);
  if (refreshed !== null) {
    response.cookies.set(ACCESS_COOKIE, refreshed.accessToken, cookieOptions(refreshed.expiresIn));
    response.cookies.set(REFRESH_COOKIE, refreshed.refreshToken, cookieOptions(60 * 60 * 24 * 7));
  }
  return response;
}

function buildTarget(service: ServiceName, path: string[], requestUrl: string): string {
  const incoming = new URL(requestUrl);
  const suffix = path.map(encodeURIComponent).join("/");
  return `${serviceBaseUrl(service)}/api/v1/${suffix}${incoming.search}`;
}

async function callUpstream(
  request: Request,
  target: string,
  access: string,
  body: string | undefined,
): Promise<Response> {
  const headers = new Headers();
  headers.set("authorization", `Bearer ${access}`);
  const contentType = request.headers.get("content-type");
  if (contentType !== null) headers.set("content-type", contentType);
  const idempotency = request.headers.get("idempotency-key");
  if (idempotency !== null) headers.set("idempotency-key", idempotency);
  try {
    return await fetch(target, { method: request.method, headers, body, cache: "no-store" });
  } catch {
    return new Response(
      JSON.stringify({
        error: { code: "SERVICE_UNAVAILABLE", message: "The service is unreachable.", requestId: null },
      }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }
}

async function toResponse(upstream: Response): Promise<NextResponse> {
  if (upstream.status === 204) return new NextResponse(null, { status: 204 });
  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
