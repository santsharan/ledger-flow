import { cookies } from "next/headers";
import { serviceBaseUrl } from "./services";
import { ACCESS_COOKIE, REFRESH_COOKIE, type SessionUser } from "./session";

interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
}

export async function readSession(): Promise<{
  user: SessionUser | null;
  accessToken: string | null;
}> {
  const jar = await cookies();
  const accessToken = jar.get(ACCESS_COOKIE)?.value ?? null;
  if (accessToken === null) return { user: null, accessToken: null };
  const user = await fetchMe(accessToken);
  return { user, accessToken };
}

export async function fetchMe(accessToken: string): Promise<SessionUser | null> {
  try {
    const response = await fetch(`${serviceBaseUrl("identity")}/api/v1/auth/me`, {
      headers: { authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as SessionUser;
  } catch {
    return null;
  }
}

export async function refreshTokens(refreshToken: string): Promise<TokenResponse | null> {
  try {
    const response = await fetch(`${serviceBaseUrl("identity")}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken }),
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as TokenResponse;
  } catch {
    return null;
  }
}

export { REFRESH_COOKIE };
