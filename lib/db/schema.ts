import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const sessions = sqliteTable("sessions", {
  idHash: text("id_hash").primaryKey(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
})

export const loginThrottle = sqliteTable("login_throttle", {
  id: integer("id").primaryKey(),
  windowStartedAt: integer("window_started_at").notNull(),
  attempts: integer("attempts").notNull(),
  blockedUntil: integer("blocked_until").notNull().default(0),
})

export const automationRuns = sqliteTable("automation_runs", {
  runId: text("run_id").primaryKey(),
  job: text("job").notNull(),
  runKey: text("run_key").notNull(),
  status: text("status").notNull(),
  startedAt: integer("started_at").notNull(),
  completedAt: integer("completed_at"),
  summary: text("summary"),
})

export const deploymentHistory = sqliteTable("deployment_history", {
  id: text("id").primaryKey(),
  repository: text("repository").notNull(),
  ref: text("ref").notNull(),
  commitSha: text("commit_sha"),
  port: integer("port").notNull(),
  status: text("status").notNull(),
  summary: text("summary"),
  startedAt: integer("started_at").notNull(),
  completedAt: integer("completed_at"),
})
