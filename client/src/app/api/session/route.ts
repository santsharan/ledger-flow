import { NextResponse } from "next/server";
import { readSession } from "@/lib/identity";

export async function GET(): Promise<NextResponse> {
  const session = await readSession();
  if (session.user === null) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Sign in required.", requestId: null } },
      { status: 401 },
    );
  }
  return NextResponse.json({ user: session.user });
}
