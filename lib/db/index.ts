import "server-only"

import { chmodSync, existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs"
import path from "node:path"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import * as schema from "./schema"

const globalForDb = globalThis as typeof globalThis & {
  homeosSqlite?: Database.Database
  homeosDrizzle?: ReturnType<typeof drizzle<typeof schema>>
  homeosDbPath?: string
}

function initializeDatabase() {
  if (globalForDb.homeosDrizzle) return globalForDb.homeosDrizzle

  const filePath = path.resolve(/*turbopackIgnore: true*/
    process.env.HOMEOS_DB_PATH || path.join(process.cwd(), ".homeos", "homeos.sqlite"),
  )
  if (process.platform !== "win32") {
    const storageRoot = path.resolve("/mnt/storage")
    const managedRoot = process.env.HOMEOS_DATA_ROOT ? path.resolve(process.env.HOMEOS_DATA_ROOT) : null
    const isInStorage = (candidate: string) => {
      const relative = path.relative(storageRoot, candidate)
      return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    }
    if (isInStorage(filePath)) {
      throw new Error("HomeOS SQLite data must not be stored on /mnt/storage.")
    }
    if (managedRoot && path.relative(managedRoot, filePath) !== ".." && !path.relative(managedRoot, filePath).startsWith(`..${path.sep}`) && !path.isAbsolute(path.relative(managedRoot, filePath))) {
      throw new Error("HomeOS SQLite data must not be stored on the managed personal data volume.")
    }
    let existingParent = path.dirname(filePath)
    while (!existsSync(existingParent)) existingParent = path.dirname(existingParent)
    const resolvedParent = realpathSync(existingParent)
    const futureParent = path.resolve(resolvedParent, path.relative(existingParent, path.dirname(filePath)))
    if (isInStorage(futureParent)) {
      throw new Error("HomeOS SQLite data must not be stored on /mnt/storage.")
    }
    if (managedRoot) {
      const resolvedRelative = path.relative(managedRoot, futureParent)
      if (resolvedRelative === "" || (!resolvedRelative.startsWith(`..${path.sep}`) && resolvedRelative !== ".." && !path.isAbsolute(resolvedRelative))) {
        throw new Error("HomeOS SQLite data must not be stored on the managed personal data volume.")
      }
    }
    if (existsSync(filePath) && lstatSync(filePath).isSymbolicLink()) {
      throw new Error("HomeOS database file cannot be a symbolic link.")
    }
  }
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
  const sqlite = new Database(filePath)
  sqlite.pragma("journal_mode = WAL")
  sqlite.pragma("foreign_keys = ON")
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id_hash TEXT PRIMARY KEY NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS login_throttle (
      id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
      window_started_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL,
      blocked_until INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS automation_runs (
      run_id TEXT PRIMARY KEY NOT NULL,
      job TEXT NOT NULL,
      run_key TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      summary TEXT,
      UNIQUE(job, run_key)
    );
    CREATE TABLE IF NOT EXISTS deployment_history (
      id TEXT PRIMARY KEY NOT NULL,
      repository TEXT NOT NULL,
      ref TEXT NOT NULL,
      commit_sha TEXT,
      port INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed')),
      summary TEXT,
      started_at INTEGER NOT NULL,
      completed_at INTEGER
    );
  `)
  try {
    chmodSync(filePath, 0o600)
    chmodSync(path.dirname(filePath), 0o700)
  } catch {
    // Windows development does not support POSIX permission bits.
  }

  globalForDb.homeosSqlite = sqlite
  globalForDb.homeosDrizzle = drizzle(sqlite, { schema })
  globalForDb.homeosDbPath = filePath
  return globalForDb.homeosDrizzle
}

export const db = initializeDatabase()

export function getNativeDatabase() {
  return globalForDb.homeosSqlite!
}

export function getDatabaseFilePath() {
  return globalForDb.homeosDbPath!
}

export function inspectDatabase() {
  const sqlite = getNativeDatabase()
  const pageCount = Number(sqlite.pragma("page_count", { simple: true }))
  const pageSize = Number(sqlite.pragma("page_size", { simple: true }))
  const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>
  return {
    file: path.basename(getDatabaseFilePath()),
    sizeBytes: pageCount * pageSize,
    pageSizeBytes: pageSize,
    pageCount,
    journalMode: sqlite.pragma("journal_mode", { simple: true }) as string,
    foreignKeys: Number(sqlite.pragma("foreign_keys", { simple: true })) === 1,
    integrity: sqlite.pragma("integrity_check", { simple: true }) as string,
    tables: tables.map(({ name }) => name),
  }
}

export function runDatabaseMaintenance(action: "checkpoint" | "vacuum") {
  const sqlite = getNativeDatabase()
  if (action === "checkpoint") sqlite.pragma("wal_checkpoint(TRUNCATE)")
  else sqlite.exec("VACUUM")
}
