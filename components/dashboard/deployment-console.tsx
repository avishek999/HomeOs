"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/button"

type Deployment = { id: string; repository: string; ref: string; commitSha: string | null; port: number; status: string; summary: string | null; startedAt: number; completedAt: number | null }
type App = { repo: string; ref: string; port: number; latest: Deployment | null; running: boolean }
type Data = { apps: App[]; configured: boolean; history: Deployment[] }

async function loadDeployments(): Promise<Data> {
  const response = await fetch("/api/deployments", { cache: "no-store" })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || "Deployment status unavailable.")
  return result as Data
}

export function DeploymentConsole() {
  const client = useQueryClient()
  const query = useQuery({ queryKey: ["deployments"], queryFn: loadDeployments, retry: false })
  const deploy = useMutation({
    mutationFn: async (repo: string) => {
      const response = await fetch("/api/deployments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repo }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "Deployment failed.")
      return result.deployment as { repo: string; commitSha: string; port: number }
    },
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["deployments"] }) },
    onError: async () => { await client.invalidateQueries({ queryKey: ["deployments"] }) },
  })
  return <div className="page-enter space-y-8 sm:space-y-10">
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border/75 pb-8"><div><p className="eyebrow mb-4">HOME SERVER <span className="mx-2 text-border">/</span> RELEASES</p><h1 className="text-[clamp(2.2rem,5vw,4rem)] leading-none font-semibold tracking-[-0.055em]">Deployments</h1><p className="mt-4 max-w-2xl text-xs leading-5 text-muted-foreground">Only configured GitHub repositories can deploy. Public apps run without HomeOS volumes, credentials, or Docker socket access, and bind to loopback ports.</p></div><Button variant="outline" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching} className="rounded-sm text-[9px] tracking-[0.12em]">REFRESH</Button></header>
    {query.isLoading && <div role="status" aria-label="Loading deployment status" className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="skeleton h-20 rounded-sm" />)}</div>}
    {query.error && <section className="border-y border-border/75 py-12 text-center"><p className="eyebrow">DEPLOYMENT STATUS UNAVAILABLE</p><p className="mt-3 text-xs text-muted-foreground">{query.error instanceof Error ? query.error.message : "Check the deployment configuration."}</p></section>}
    {deploy.error && <p role="alert" className="text-xs text-destructive">{deploy.error.message}</p>}
    {query.data && !query.data.configured && <section className="border-y border-border/75 py-8"><p className="eyebrow">GITHUB NOT CONFIGURED</p><p className="mt-3 max-w-2xl text-xs leading-5 text-muted-foreground">Set a fine-grained GitHub token with read-only Contents permission and an explicit HOMEOS_GITHUB_REPOSITORIES allow-list, then restart HomeOS.</p></section>}
    {query.data && query.data.apps.length === 0 && <section className="border-y border-border/75 py-12 text-center"><p className="eyebrow">NO ALLOWED REPOSITORIES</p><p className="mt-3 text-xs text-muted-foreground">Add repository, branch, and unique port entries to HOMEOS_GITHUB_REPOSITORIES.</p></section>}
    {query.data?.apps.map((app) => <article key={app.repo} className="border-b border-border/65 py-6"><div className="flex flex-wrap items-center justify-between gap-4"><div className="min-w-0"><div className="flex items-center gap-2"><h2 className="truncate text-sm font-medium">{app.repo}</h2><span className={`size-1.5 rounded-full ${app.running ? "bg-emerald-500" : "bg-muted-foreground"}`} /></div><p className="mt-1 font-mono text-[10px] text-muted-foreground">{app.ref} <span className="mx-1">·</span> 127.0.0.1:{app.port}</p><p className="mt-2 text-[10px] text-muted-foreground">{app.latest?.summary || "No deployment history yet."}</p></div><Button disabled={deploy.isPending || !query.data.configured} onClick={() => { if (window.confirm(`Build and deploy ${app.repo} from ${app.ref}?`)) deploy.mutate(app.repo) }} className="rounded-sm text-[9px] tracking-[0.12em]">{deploy.isPending ? "BUILDING" : "DEPLOY"}</Button></div></article>)}
    {query.data?.history.length ? <section><p className="eyebrow">RECENT RUNS</p><div className="mt-3 divide-y divide-border/50 border-y border-border/70">{query.data.history.slice(0, 10).map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-[10px]"><span className="truncate font-mono">{item.repository} · {item.commitSha?.slice(0, 12) || item.ref}</span><span className={item.status === "succeeded" ? "text-emerald-600" : item.status === "failed" ? "text-destructive" : "text-muted-foreground"}>{item.status.toUpperCase()}</span></div>)}</div></section> : null}
  </div>
}
