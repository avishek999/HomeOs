"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"

type Backup = { name: string; createdAt: string; uploadCount: number; totalUploadBytes: number; backupBytes: number; integrity: string }
type Schedule = { enabled: boolean; hourUtc: number; retention: number }
type Run = { job: string; status: string; started_at: number; completed_at: number | null; summary: string | null } | null
async function loadBackups(): Promise<{ backups: Backup[]; schedule: Schedule; latestRun: Run }> {
  const response = await fetch("/api/backups", { cache: "no-store" })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || "Backup history unavailable.")
  return result as { backups: Backup[]; schedule: Schedule; latestRun: Run }
}

function size(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const unit = bytes < 1024 ** 2 ? "KB" : bytes < 1024 ** 3 ? "MB" : "GB"
  const divisor = unit === "KB" ? 1024 : unit === "MB" ? 1024 ** 2 : 1024 ** 3
  return `${(bytes / divisor).toFixed(1)} ${unit}`
}

export function BackupConsole() {
  const client = useQueryClient()
  const query = useQuery({ queryKey: ["backups"], queryFn: loadBackups, retry: false })
  const create = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/backups", { method: "POST" })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "Backup failed.")
      return result.backup as Backup
    },
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["backups"] }) },
  })
  const verify = useMutation({
    mutationFn: async (name: string) => {
      const response = await fetch("/api/backups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "verify", name }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "Backup verification failed.")
      return result.verification as { name: string; fileCount: number; integrity: string }
    },
  })
  return <div className="page-enter space-y-8 sm:space-y-10">
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border/75 pb-8"><div><p className="eyebrow mb-4">HOME SERVER <span className="mx-2 text-border">/</span> PROTECTION</p><h1 className="text-[clamp(2.2rem,5vw,4rem)] leading-none font-semibold tracking-[-0.055em]">Backups</h1><p className="mt-4 max-w-xl text-xs leading-5 text-muted-foreground">Snapshots include the HomeOS database and managed uploads. They are stored only on the separate data volume.</p></div><Button onClick={() => create.mutate()} disabled={create.isPending} className="rounded-sm text-[9px] font-semibold tracking-[0.12em]">{create.isPending ? "BACKING UP" : "CREATE BACKUP"}</Button></header>
    <div role="status" className="min-h-5 text-xs text-muted-foreground">{create.error instanceof Error ? create.error.message : create.isSuccess ? `Verified backup ${create.data.name}` : verify.error instanceof Error ? verify.error.message : verify.isSuccess ? `Verified ${verify.data.fileCount} files in ${verify.data.name}.` : "Each backup is integrity checked. Retention defaults to 7 snapshots; the backup volume quota defaults to 50 GiB."}</div>
    {query.isLoading && <div role="status" aria-label="Loading backup history" className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-10 rounded-sm" />)}</div>}
    {query.error && <section className="border-y border-border/75 py-12 text-center"><p className="eyebrow">BACKUP VOLUME NOT READY</p><p className="mt-3 text-xs text-muted-foreground">{query.error instanceof Error ? query.error.message : "Configure HOMEOS_DATA_ROOT and retry."}</p><Button variant="outline" size="sm" className="mt-5 rounded-sm text-[9px] tracking-[0.12em]" onClick={() => void query.refetch()}>RETRY</Button></section>}
    {query.data && <><section className="grid gap-4 border-y border-border/70 py-5 sm:grid-cols-2"><div><p className="eyebrow">AUTOMATION</p><p className="mt-2 text-xs">{query.data.schedule.enabled ? `Daily snapshot at ${String(query.data.schedule.hourUtc).padStart(2, "0")}:00 UTC` : "Scheduled backups disabled"}</p><p className="mt-1 text-[10px] text-muted-foreground">Retention: {query.data.schedule.retention} snapshots. Failed jobs are recorded.</p></div><div><p className="eyebrow">LAST RUN</p><p className="mt-2 text-xs">{query.data.latestRun ? `${query.data.latestRun.job} · ${query.data.latestRun.status.toUpperCase()}` : "No scheduled run yet"}</p><p className="mt-1 text-[10px] text-muted-foreground">{query.data.latestRun?.summary || "The scheduler catches up after a restart."}</p></div></section><section><div className="grid grid-cols-[minmax(0,1fr)_75px_80px_100px] border-b border-border/70 py-3 text-[8px] font-semibold tracking-[0.17em] text-muted-foreground"><span>SNAPSHOT</span><span>SIZE</span><span className="text-right">CHECK</span><span /></div>{query.data.backups.map((backup) => <div key={backup.name} className="grid grid-cols-[minmax(0,1fr)_75px_80px_100px] items-center gap-2 border-b border-border/50 py-4 text-[10px]"><div className="min-w-0"><p className="truncate font-mono">{backup.name}</p><p className="mt-1 text-[9px] text-muted-foreground">{new Date(backup.createdAt).toLocaleString()} · {backup.uploadCount} uploads</p></div><span className="text-muted-foreground">{size(backup.backupBytes)}</span><span className="text-right text-emerald-600">{backup.integrity.toUpperCase()}</span><Button variant="outline" size="sm" disabled={verify.isPending} onClick={() => verify.mutate(backup.name)} className="rounded-sm text-[8px] tracking-[0.08em]">{verify.isPending ? "CHECKING" : "VERIFY"}</Button></div>)}{query.data.backups.length === 0 && <div className="border-b border-border/75 py-14 text-center"><p className="eyebrow">NO BACKUPS YET</p><p className="mt-3 text-xs text-muted-foreground">Create a verified snapshot before configuring a schedule.</p></div>}</section></>}
  </div>
}
