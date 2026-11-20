import { NextResponse } from "next/server"
import { clearSessionCookieOptions, loginOriginIsValid, requireSession, revokeCurrentSession, SESSION_COOKIE } from "@/lib/auth/session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  if (!loginOriginIsValid(request)) {
    return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 })
  }
  if (!(await requireSession())) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 })
  }
  await revokeCurrentSession()
  const response = NextResponse.json({ authenticated: false }, { headers: { "Cache-Control": "no-store" } })
  response.cookies.set(SESSION_COOKIE, "", clearSessionCookieOptions())
  return response
}
