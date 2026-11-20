import "server-only"

import { randomUUID } from "node:crypto"
import { getNativeDatabase } from "@/lib/db"
import { createBackup } from "@/lib/backups"

const schedulerGlobal = globalThis as typeof globalThis & { homeosBackupTimer?: NodeJS.Timeout }

export function getBackupSchedule() {
  const enabled = process.env.HOMEOS_BACKUP_ENABLED !== "false"
  const hour = process.env.HOMEOS_BACKUP_HOUR_UTC ? Number(process.env.HOMEOS_BACKUP_HOUR_UTC) : 3
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error("HOMEOS_BACKUP_HOUR_UTC must be an integer from 0 to 23.")
  return { enabled, hourUtc: hour, retention: process.env.HOMEOS_BACKUP_RETENTION ? Number(process.env.HOMEOS_BACKUP_RETENTION) : 7 }
}

export function getLatestAutomationRun() {
  const database = getNativeDatabase()
  return database.prepare("SELECT job, status, started_at, completed_at, summary FROM automation_runs ORDER BY started_at DESC LIMIT 1").get() as { job: string; status: string; started_at: number; completed_at: number | null; summary: string | null } | undefined
}

export async function runDailyBackupIfDue(now = new Date()) {
  const schedule = getBackupSchedule()
  if (!schedule.enabled || now.getUTCHours() < schedule.hourUtc) return false
  const date = now.toISOString().slice(0, 10)
  const database = getNativeDatabase()
  const runId = randomUUID()
  const inserted = database.prepare("INSERT OR IGNORE INTO automation_runs (run_id, job, run_key, status, started_at) VALUES (?, 'daily-backup', ?, 'running', ?)").run(runId, date, now.getTime())
  if (inserted.changes !== 1) return false
  try {
    const backup = await createBackup()
    database.prepare("UPDATE automation_runs SET status = 'completed', completed_at = ?, summary = ? WHERE run_id = ?").run(Date.now(), `Verified ${backup.name}`, runId)
  } catch {
    database.prepare("UPDATE automation_runs SET status = 'failed', completed_at = ?, summary = 'Backup failed; see server logs.' WHERE run_id = ?").run(Date.now(), runId)
  }
  return true
}

export function startBackupScheduler() {
  if (process.env.NODE_ENV !== "production" || !getBackupSchedule().enabled || schedulerGlobal.homeosBackupTimer) return
  const tick = () => { void runDailyBackupIfDue().catch((error) => console.error("HomeOS backup scheduler failed.", error instanceof Error ? error.message : "unknown error")) }
  tick()
  schedulerGlobal.homeosBackupTimer = setInterval(tick, 60_000)
  schedulerGlobal.homeosBackupTimer.unref()
}
