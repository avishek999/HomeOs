"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"

type Info = { file: string; sizeBytes: number; pageSizeBytes: number; pageCount: number; journalMode: string; foreignKeys: boolean; integrity: string; tables: string[] }

async function loadDatabase(): Promise<Info> {
  const response = await fetch("/api/database", { cache: "no-store" })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || "Database status unavailable.")
  return data as Info
}

function size(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB"]
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)) - 1, units.length - 1)
  return `${(bytes / 1024 ** (index + 1)).toFixed(1)} ${units[index]}`
}

export function DatabaseConsole() {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ["database"], queryFn: loadDatabase, retry: false })
  const maintenance = useMutation({
    mutationFn: async (action: "checkpoint" | "vacuum") => {
      const response = await fetch("/api/database", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "Maintenance failed.")
      return result.database as Info
    },
    onSuccess: (database) => queryClient.setQueryData(["database"], database),
  })
  const info = query.data

  return <div className="page-enter space-y-8 sm:space-y-10">
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border/75 pb-8"><div><p className="eyebrow mb-4">HOME SERVER <span className="mx-2 text-border">/</span> SQLITE</p><h1 className="text-[clamp(2.2rem,5vw,4rem)] leading-none font-semibold tracking-[-0.055em]">Database</h1><p className="mt-4 max-w-xl text-xs leading-5 text-muted-foreground">Safe maintenance for HomeOS’s private SQLite database. No arbitrary SQL console is exposed.</p></div><Button variant="outline" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching} className="rounded-sm text-[9px] tracking-[0.12em]">{query.isFetching ? "CHECKING" : "CHECK STATUS"}</Button></header>
    {query.isLoading && <div className="skeleton h-44 rounded-sm" role="status" aria-label="Loading database status" />}
    {query.error && <section className="border-y border-border/75 py-10 text-center"><p className="eyebrow">DATABASE STATUS UNAVAILABLE</p><p className="mt-3 text-xs text-muted-foreground">{query.error instanceof Error ? query.error.message : "Try again later."}</p></section>}
    {info && <>
      <section className="grid grid-cols-2 gap-5 border-y border-border/75 py-7 md:grid-cols-4">{[["FILE", info.file], ["SIZE", size(info.sizeBytes)], ["JOURNAL", info.journalMode.toUpperCase()], ["INTEGRITY", info.integrity.toUpperCase()]].map(([label, value]) => <div key={label}><p className="eyebrow">{label}</p><p className="mt-2 truncate text-base font-medium tracking-tight">{value}</p></div>)}</section>
      <section className="grid gap-8 lg:grid-cols-[1fr_280px]"><div><p className="eyebrow">APPLICATION TABLES</p><div className="mt-4 border-y border-border/70">{info.tables.map((table) => <div key={table} className="flex items-center justify-between border-b border-border/50 py-3 last:border-0"><span className="font-mono text-xs">{table}</span><span className="text-[9px] text-muted-foreground">SQLITE TABLE</span></div>)}</div><p className="mt-3 text-[10px] text-muted-foreground">Foreign key enforcement {info.foreignKeys ? "enabled" : "disabled"}. {info.pageCount.toLocaleString()} pages at {info.pageSizeBytes.toLocaleString()} bytes each.</p></div>
        <div className="space-y-3"><p className="eyebrow">MAINTENANCE</p><Button variant="outline" className="w-full rounded-sm text-[9px] tracking-[0.1em]" disabled={maintenance.isPending} onClick={() => maintenance.mutate("checkpoint")}>CHECKPOINT WRITE-AHEAD LOG</Button><Button variant="outline" className="w-full rounded-sm text-[9px] tracking-[0.1em]" disabled={maintenance.isPending} onClick={() => { if (window.confirm("Compact the HomeOS SQLite database? This can pause the dashboard briefly.")) maintenance.mutate("vacuum") }}>COMPACT DATABASE</Button>{maintenance.error && <p role="alert" className="text-xs text-destructive">{maintenance.error.message}</p>}{maintenance.isSuccess && <p role="status" className="text-xs text-emerald-600">Maintenance completed.</p>}</div>
      </section>
    </>}
  </div>
}
