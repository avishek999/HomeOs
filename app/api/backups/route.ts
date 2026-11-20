import { NextResponse } from "next/server"
import { loginOriginIsValid, requireSession } from "@/lib/auth/session"
import { createBackup, listBackups, verifyBackup } from "@/lib/backups"
import { getBackupSchedule, getLatestAutomationRun } from "@/lib/backups/scheduler"
import { StoragePathError } from "@/lib/storage/path-policy"
import { readBoundedText } from "@/lib/server/request-body"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
let backupInProgress = false

export async function GET() {
  if (!(await requireSession())) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } })
  try { return NextResponse.json({ backups: await listBackups(), schedule: getBackupSchedule(), latestRun: getLatestAutomationRun() ?? null }, { headers: { "Cache-Control": "no-store" } }) }
  catch (error) {
    if (error instanceof StoragePathError) return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } })
    return NextResponse.json({ error: "Backup history is unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } })
  }
}

export async function POST(request: Request) {
  if (!(await requireSession())) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } })
  if (!loginOriginIsValid(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 })
  if (backupInProgress) return NextResponse.json({ error: "A backup is already running." }, { status: 409 })
  backupInProgress = true
  try {
    const body = await readBoundedText(request, 1024)
    if (body) {
      let input: unknown
      try { input = JSON.parse(body) }
      catch { return NextResponse.json({ error: "Invalid request body." }, { status: 400 }) }
      const requestBody = input as { action?: unknown; name?: unknown } | null
      if (requestBody?.action === "verify" && typeof requestBody.name === "string") {
        const result = await verifyBackup(requestBody.name)
        return NextResponse.json({ verification: result }, { headers: { "Cache-Control": "no-store" } })
      }
      if (requestBody?.action !== "create") return NextResponse.json({ error: "Unsupported backup operation." }, { status: 400 })
    }
    const backup = await createBackup()
    return NextResponse.json({ backup }, { status: 201, headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    if (error instanceof StoragePathError) return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } })
    if (error instanceof Error && error.name === "RequestBodyTooLargeError") return NextResponse.json({ error: "Request is too large." }, { status: 413 })
    return NextResponse.json({ error: "Backup creation or verification failed." }, { status: 503, headers: { "Cache-Control": "no-store" } })
  } finally { backupInProgress = false }
}
