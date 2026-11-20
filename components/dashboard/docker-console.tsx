"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import type { ManagedContainer } from "@/lib/services/docker"
import { Button } from "@/components/ui/button"

async function loadContainers(): Promise<ManagedContainer[]> {
  const response = await fetch("/api/docker", { cache: "no-store" })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || "Docker helper is unavailable.")
  return result.containers as ManagedContainer[]
}

export function DockerConsole() {
  const [selected, setSelected] = useState<string | null>(null)
  const client = useQueryClient()
  const query = useQuery({ queryKey: ["docker-managed"], queryFn: loadContainers, retry: false, refetchInterval: 15_000 })
  const logs = useQuery({ queryKey: ["docker-logs", selected], enabled: Boolean(selected), queryFn: async () => {
    const response = await fetch(`/api/docker?logs=${encodeURIComponent(selected!)}`, { cache: "no-store" })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error || "Container logs unavailable.")
    return result.logs as string
  }, refetchInterval: 10_000, retry: false })
  const control = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "start" | "stop" | "restart" }) => {
      const response = await fetch("/api/docker", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "Container action failed.")
    },
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["docker-managed"] }) },
  })
  return <div className="page-enter space-y-8 sm:space-y-10">
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border/75 pb-8"><div><p className="eyebrow mb-4">HOME SERVER <span className="mx-2 text-border">/</span> SERVICES</p><h1 className="text-[clamp(2.2rem,5vw,4rem)] leading-none font-semibold tracking-[-0.055em]">Docker</h1><p className="mt-4 max-w-2xl text-xs leading-5 text-muted-foreground">Only containers labeled <code className="font-mono text-foreground/80">com.homeos.managed=true</code> appear here. The web app has no Docker socket access.</p></div><Button variant="outline" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching} className="rounded-sm text-[9px] tracking-[0.12em]">{query.isFetching ? "CHECKING" : "REFRESH"}</Button></header>
    {query.isLoading && <div className="space-y-3" role="status" aria-label="Loading Docker containers">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-16 rounded-sm" />)}</div>}
    {query.error && <section className="border-y border-border/75 py-12 text-center"><p className="eyebrow">DOCKER HELPER UNAVAILABLE</p><p className="mx-auto mt-3 max-w-xl text-xs leading-5 text-muted-foreground">{query.error instanceof Error ? query.error.message : "Start the isolated helper and configure its secret and socket group."}</p></section>}
    {control.error && <p role="alert" className="text-xs text-destructive">{control.error.message}</p>}
    {query.data && <section className="divide-y divide-border/55 border-y border-border/75">{query.data.map((container) => <article key={container.id} className="py-5"><div className="flex flex-wrap items-center justify-between gap-4"><div className="min-w-0"><div className="flex items-center gap-2"><span className={`size-1.5 rounded-full ${container.status === "running" ? "bg-emerald-500" : "bg-muted-foreground"}`} /><h2 className="truncate text-sm font-medium">{container.name}</h2><span className="text-[8px] tracking-[0.1em] text-muted-foreground">{container.status.toUpperCase()}</span></div><p className="mt-2 truncate font-mono text-[9px] text-muted-foreground">{container.image} <span className="mx-1">·</span> {container.detail}</p></div><div className="flex flex-wrap gap-2">{(container.status === "running" ? ["restart", "stop"] as const : ["start"] as const).map((action) => <Button key={action} variant="outline" size="sm" className="rounded-sm text-[8px] tracking-[0.1em]" disabled={control.isPending} onClick={() => control.mutate({ id: container.id, action })}>{action.toUpperCase()}</Button>)}<Button variant="ghost" size="sm" className="rounded-sm text-[8px] tracking-[0.1em]" onClick={() => setSelected((current) => current === container.id ? null : container.id)}>{selected === container.id ? "HIDE LOGS" : "LOGS"}</Button></div></div>{selected === container.id && <div className="mt-4 border-t border-border/50 pt-4"><div className="mb-2 flex items-center justify-between"><p className="eyebrow">LAST 200 LOG LINES · REDACTED</p><Button variant="ghost" size="sm" className="text-[8px] tracking-[0.1em]" onClick={() => void logs.refetch()}>REFRESH LOGS</Button></div>{logs.error ? <p className="text-xs text-destructive">{logs.error.message}</p> : <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-foreground/[0.035] p-4 font-mono text-[10px] leading-5 text-muted-foreground">{logs.data || (logs.isLoading ? "Loading logs…" : "No logs returned.")}</pre>}</div>}</article>)}</section>}
    {query.data?.length === 0 && <div className="border-y border-border/75 py-14 text-center"><p className="eyebrow">NO MANAGED CONTAINERS</p><p className="mt-3 text-xs text-muted-foreground">Containers appear here only when labeled as HomeOS managed.</p></div>}
  </div>
}
