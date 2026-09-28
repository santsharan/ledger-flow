import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { ACCESS_COOKIE, cookieOptions } from "@/lib/session";
import { serviceBaseUrl } from "@/lib/services";

export async function POST(): Promise<NextResponse> {
  const jar = await cookies();
  const access = jar.get(ACCESS_COOKIE)?.value;
  if (access !== undefined) {
    await fetch(`${serviceBaseUrl("identity")}/api/v1/auth/logout`, {
      method: "POST",
      headers: { authorization: `Bearer ${access}` },
      cache: "no-store",
    }).catch(() => undefined);
  }
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(ACCESS_COOKIE, "", cookieOptions(0));
  response.cookies.set("lf_refresh", "", cookieOptions(0));
  return response;
}
