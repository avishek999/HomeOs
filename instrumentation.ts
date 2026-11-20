import { assertNonRoot } from "@/lib/server/runtime"

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  const getuid = Reflect.get(process, "getuid") as (() => number) | undefined
  assertNonRoot(getuid?.call(process))
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { startBackupScheduler } = await import("@/lib/backups/scheduler")
    startBackupScheduler()
  }
}
