export const ACCESS_COOKIE = "lf_access";
export const REFRESH_COOKIE = "lf_refresh";

export interface SessionUser {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly status: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly merchantId: string | null;
}

export function cookieOptions(maxAge: number): {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}
