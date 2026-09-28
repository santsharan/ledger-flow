import { NextResponse } from "next/server";
import { fetchMe } from "@/lib/identity";
import { serviceBaseUrl } from "@/lib/services";
import { ACCESS_COOKIE, REFRESH_COOKIE, cookieOptions } from "@/lib/session";

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Login body must be JSON.", requestId: null } },
      { status: 400 },
    );
  }

  let login: Response;
  try {
    login = await fetch(`${serviceBaseUrl("identity")}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "IDENTITY_UNAVAILABLE",
          message: "Identity service is unreachable.",
          requestId: null,
        },
      },
      { status: 502 },
    );
  }

  const payload: unknown = await login.json().catch(() => null);
  if (!login.ok) return NextResponse.json(payload, { status: login.status });

  const tokens = payload as { accessToken?: string; refreshToken?: string; expiresIn?: number };
  if (
    typeof tokens.accessToken !== "string" ||
    typeof tokens.refreshToken !== "string" ||
    typeof tokens.expiresIn !== "number"
  ) {
    return NextResponse.json(
      { error: { code: "IDENTITY_UNAVAILABLE", message: "Identity returned an unexpected response.", requestId: null } },
      { status: 502 },
    );
  }

  const user = await fetchMe(tokens.accessToken);
  if (user === null) {
    return NextResponse.json(
      { error: { code: "IDENTITY_UNAVAILABLE", message: "Signed in, but the profile could not be loaded.", requestId: null } },
      { status: 502 },
    );
  }

  const response = NextResponse.json({ user });
  response.cookies.set(ACCESS_COOKIE, tokens.accessToken, cookieOptions(tokens.expiresIn));
  response.cookies.set(REFRESH_COOKIE, tokens.refreshToken, cookieOptions(60 * 60 * 24 * 7));
  return response;
}
