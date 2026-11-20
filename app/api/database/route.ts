import { NextResponse } from "next/server"
import { inspectDatabase, runDatabaseMaintenance } from "@/lib/db"
import { loginOriginIsValid, requireSession } from "@/lib/auth/session"
import { readBoundedText } from "@/lib/server/request-body"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  if (!(await requireSession())) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } })
  try { return NextResponse.json(inspectDatabase(), { headers: { "Cache-Control": "no-store" } }) }
  catch { return NextResponse.json({ error: "Database diagnostics are unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } }) }
}

export async function POST(request: Request) {
  if (!(await requireSession())) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } })
  if (!loginOriginIsValid(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 })
  let action: unknown
  try {
    const body = await readBoundedText(request, 1024)
    action = (JSON.parse(body) as { action?: unknown }).action
  } catch (error) { return NextResponse.json({ error: error instanceof Error && error.name === "RequestBodyTooLargeError" ? "Request is too large." : "Invalid request body." }, { status: error instanceof Error && error.name === "RequestBodyTooLargeError" ? 413 : 400 }) }
  if (action !== "checkpoint" && action !== "vacuum") return NextResponse.json({ error: "Unsupported database operation." }, { status: 400 })
  try {
    runDatabaseMaintenance(action)
    return NextResponse.json({ ok: true, database: inspectDatabase() }, { headers: { "Cache-Control": "no-store" } })
  } catch { return NextResponse.json({ error: "Database maintenance failed." }, { status: 503, headers: { "Cache-Control": "no-store" } }) }
}
