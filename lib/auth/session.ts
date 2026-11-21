import "server-only"

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto"
import { cookies } from "next/headers"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { loginThrottle, sessions } from "@/lib/db/schema"

export const SESSION_COOKIE = "homeos_session"
const SESSION_TTL_SECONDS = 60 * 60 * 12
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const MAX_ATTEMPTS = 8
const BLOCK_MS = 15 * 60 * 1000

function hashSession(token: string) {
  return createHmac("sha256", process.env.HOMEOS_SESSION_SECRET || "unconfigured")
    .update(token)
    .digest("hex")
}

export function verifyPassword(password: string) {
  const setting = process.env.HOMEOS_PASSWORD_HASH
  if (!setting) return false

  const [salt, expectedHex, extra] = setting.split(":")
  if (!salt || !expectedHex || extra || !/^[a-f\d]{32,128}$/i.test(salt) || !/^[a-f\d]{128}$/i.test(expectedHex)) {
    return false
  }

  const expected = Buffer.from(expectedHex, "hex")
  const actual = scryptSync(password, salt, expected.length)
  return timingSafeEqual(actual, expected)
}

export function authIsConfigured() {
  const [salt, hash, extra] = (process.env.HOMEOS_PASSWORD_HASH || "").split(":")
  return Boolean(
    salt && hash && !extra && /^[a-f\d]{32,128}$/i.test(salt) && /^[a-f\d]{128}$/i.test(hash) &&
    (process.env.HOMEOS_SESSION_SECRET?.length ?? 0) >= 32,
  )
}

export function loginIsBlocked(now = Date.now()) {
  const state = db.select().from(loginThrottle).where(eq(loginThrottle.id, 1)).get()
  return state ? state.blockedUntil > now : false
}

export function recordLoginAttempt(success: boolean, now = Date.now()) {
  const state = db.select().from(loginThrottle).where(eq(loginThrottle.id, 1)).get()
  if (success) {
    db.delete(loginThrottle).where(eq(loginThrottle.id, 1)).run()
    return
  }

  const withinWindow = state && now - state.windowStartedAt < LOGIN_WINDOW_MS
  const attempts = withinWindow ? state.attempts + 1 : 1
  db.insert(loginThrottle)
    .values({
      id: 1,
      windowStartedAt: withinWindow ? state.windowStartedAt : now,
      attempts,
      blockedUntil: attempts >= MAX_ATTEMPTS ? now + BLOCK_MS : 0,
    })
    .onConflictDoUpdate({
      target: loginThrottle.id,
      set: {
        windowStartedAt: withinWindow ? state.windowStartedAt : now,
        attempts,
        blockedUntil: attempts >= MAX_ATTEMPTS ? now + BLOCK_MS : 0,
      },
    })
    .run()
}

export function createSession() {
  if (!authIsConfigured()) throw new Error("HomeOS authentication is not configured.")
  const token = randomBytes(32).toString("base64url")
  const now = Date.now()
  db.insert(sessions)
    .values({
      idHash: hashSession(token),
      createdAt: now,
      expiresAt: now + SESSION_TTL_SECONDS * 1000,
    })
    .run()
  return { token, maxAge: SESSION_TTL_SECONDS }
}

export async function getValidSession() {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (!token || token.length > 100) return null
  const row = db
    .select({ expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(eq(sessions.idHash, hashSession(token)))
    .get()
  if (!row || row.expiresAt <= Date.now()) {
    if (row) db.delete(sessions).where(eq(sessions.idHash, hashSession(token))).run()
    return null
  }
  return { authenticated: true as const }
}

export async function revokeCurrentSession() {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (token && token.length <= 100) {
    db.delete(sessions).where(eq(sessions.idHash, hashSession(token))).run()
  }
}

export async function requireSession() {
  return getValidSession()
}

export function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    // Keep production cookies HTTPS-only unless an operator explicitly enables
    // temporary HTTP access on a private network.
    secure: process.env.NODE_ENV === "production" && process.env.HOMEOS_COOKIE_SECURE !== "false",
    sameSite: "strict" as const,
    path: "/",
    maxAge,
  }
}

export function clearSessionCookieOptions() {
  return { ...sessionCookieOptions(0), expires: new Date(0) }
}

export function loginOriginIsValid(request: Request) {
  const origin = request.headers.get("origin")
  if (!origin) return false
  try {
    return new URL(origin).host === request.headers.get("host")
  } catch {
    return false
  }
}
