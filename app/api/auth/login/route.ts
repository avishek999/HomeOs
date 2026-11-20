import { NextResponse } from "next/server"
import { readBoundedText } from "@/lib/server/request-body"
import {
  authIsConfigured,
  createSession,
  loginIsBlocked,
  loginOriginIsValid,
  recordLoginAttempt,
  sessionCookieOptions,
  verifyPassword,
  SESSION_COOKIE,
} from "@/lib/auth/session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  if (!loginOriginIsValid(request)) {
    return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 })
  }
  if (!authIsConfigured()) {
    return NextResponse.json({ error: "Sign-in is not configured on this server." }, { status: 503 })
  }
  if (loginIsBlocked()) {
    return NextResponse.json({ error: "Too many attempts. Wait a few minutes and try again." }, { status: 429 })
  }

  let body: unknown
  try {
    const text = await readBoundedText(request, 2048)
    body = JSON.parse(text)
  } catch {
    return NextResponse.json({ error: "Enter a valid password." }, { status: 400 })
  }
  const password = (body as { password?: unknown } | null)?.password
  if (typeof password !== "string" || password.length === 0 || password.length > 1024) {
    recordLoginAttempt(false)
    return NextResponse.json({ error: "The password is incorrect." }, { status: 401 })
  }

  const valid = verifyPassword(password)
  recordLoginAttempt(valid)
  if (!valid) return NextResponse.json({ error: "The password is incorrect." }, { status: 401 })

  try {
    const session = createSession()
    const response = NextResponse.json({ authenticated: true })
    response.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.maxAge))
    response.headers.set("Cache-Control", "no-store")
    return response
  } catch {
    return NextResponse.json({ error: "Unable to start a secure session." }, { status: 503 })
  }
}
