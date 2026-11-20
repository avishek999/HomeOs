"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { DashboardSkeleton } from "@/components/dashboard/dashboard-skeleton"
import type { SystemMetrics } from "@/lib/system/metrics"

type HistoryPoint = { time: string; cpu: number; memory: number }
type MetricsSnapshot = { metrics: SystemMetrics; history: HistoryPoint[] }

async function fetchMetrics(previous?: MetricsSnapshot): Promise<MetricsSnapshot> {
  const response = await fetch("/api/system", { cache: "no-store" })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || "Metrics are not available.")
  const metrics = result as SystemMetrics
  const point = { time: new Date(metrics.sampledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }), cpu: metrics.cpuPercent, memory: Math.round((metrics.memoryUsed / metrics.memoryTotal) * 100) }
  return { metrics, history: [...(previous?.history ?? []).slice(-35), point] }
}

function formatBytes(bytes: number) {
  if (!bytes) return "—"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const tier = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** tier).toFixed(tier > 1 ? 1 : 0)} ${units[tier]}`
}

function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${days}d ${hours}h ${minutes}m`
}

export function MetricsDashboard() {
  const queryClient = useQueryClient()
  const { data: snapshot, error, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["system-metrics"],
    queryFn: () => fetchMetrics(queryClient.getQueryData<MetricsSnapshot>(["system-metrics"])),
    refetchInterval: 4_000,
  })
  const [range, setRange] = useState<"LIVE" | "1 MIN">("LIVE")

  if (isLoading) return <DashboardSkeleton />
  if (error || !snapshot) return <div className="flex min-h-[55vh] flex-col items-center justify-center text-center"><p className="eyebrow">SYSTEM TELEMETRY</p><h1 className="mt-4 text-2xl font-semibold tracking-tight">Signal unavailable</h1><p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{error instanceof Error ? error.message : "The server metrics could not be reached."}</p><Button className="mt-6" variant="outline" onClick={() => void refetch()}>Reconnect</Button></div>

  const { metrics: data, history } = snapshot
  const memoryPercent = data.memoryTotal ? (data.memoryUsed / data.memoryTotal) * 100 : 0
  const storagePercent = data.storageTotal ? (data.storageUsed / data.storageTotal) * 100 : 0
  const visibleHistory = range === "LIVE" ? history.slice(-12) : history
  const lastSample = new Date(data.sampledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  const stats = [
    { label: "PROCESSOR", value: `${data.cpuPercent.toFixed(data.cpuPercent % 1 ? 1 : 0)}%`, detail: `${data.cpuCores} logical cores`, fill: data.cpuPercent },
    { label: "MEMORY", value: formatBytes(data.memoryUsed), detail: `${memoryPercent.toFixed(0)}% of ${formatBytes(data.memoryTotal)}`, fill: memoryPercent },
    { label: "SYSTEM DISK", value: formatBytes(data.storageUsed), detail: `${storagePercent.toFixed(0)}% of ${formatBytes(data.storageTotal)}`, fill: storagePercent },
    { label: "UPTIME", value: formatUptime(data.uptimeSeconds), detail: "Since last restart", fill: undefined },
  ]

  return <div className="space-y-10 sm:space-y-12">
    <section className="flex flex-col justify-between gap-7 border-b border-border/75 pb-8 sm:flex-row sm:items-end sm:pb-10">
      <div className="min-w-0"><p className="eyebrow mb-4">HOME SERVER <span className="mx-2 text-border">/</span> SYSTEM OVERVIEW</p><h1 className="max-w-full truncate text-[clamp(2.2rem,5vw,4.25rem)] leading-[0.98] font-semibold tracking-[-0.055em]" title={data.hostname}>{data.hostname}</h1><p className="mt-4 text-[13px] tracking-[0.015em] text-muted-foreground">{data.platform}</p></div>
      <div className="flex shrink-0 flex-col gap-2 sm:items-end"><span className="inline-flex items-center gap-2 text-[10px] font-semibold tracking-[0.18em] text-emerald-400"><span className="size-1.5 rounded-full bg-emerald-400" />SYSTEM ONLINE</span><span className="text-[10px] tracking-[0.1em] text-muted-foreground">SAMPLED {lastSample}</span></div>
    </section>

    <section aria-label="Current server metrics" className="grid grid-cols-2 border-y border-border/75 lg:grid-cols-4">
      {stats.map((stat, index) => <div key={stat.label} className={`metric-enter min-w-0 py-5 sm:py-6 ${index % 2 === 0 ? "pr-4" : "pl-4"} ${index > 0 ? "border-l border-border/75 pl-4 sm:pl-6" : ""} ${index >= 2 ? "border-t border-border/75 lg:border-t-0" : ""} ${index % 2 === 0 && index > 0 ? "lg:pl-6" : ""} ${index < 2 ? "lg:pr-6" : ""}`} style={{ animationDelay: `${index * 55}ms` }}>
        <p className="eyebrow">{stat.label}</p><p className="mt-3 truncate text-[clamp(1.5rem,2.4vw,2.25rem)] leading-none font-medium tracking-[-0.045em] tabular-nums" title={stat.value}>{stat.value}</p><p className="mt-2 truncate text-[10px] tracking-[0.04em] text-muted-foreground" title={stat.detail}>{stat.detail}</p>
        {stat.fill !== undefined && <div className="mt-4 h-px w-full bg-border"><div className={`h-px transition-[width] duration-700 ease-out ${stat.fill >= 90 ? "bg-red-400" : stat.fill >= 75 ? "bg-amber-300" : "bg-primary"}`} style={{ width: `${Math.max(0, Math.min(stat.fill, 100))}%` }} /></div>}
      </div>)}
    </section>

    <div className="grid gap-10 xl:grid-cols-[minmax(0,1.75fr)_minmax(250px,0.75fr)] xl:gap-14">
      <section className="min-w-0">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border/65 pb-4"><div><p className="eyebrow">PERFORMANCE</p><h2 className="mt-2 text-[15px] font-medium tracking-tight">Resource activity</h2></div><div className="flex items-center gap-5"><div className="hidden gap-3 text-[9px] font-medium tracking-[0.13em] sm:flex"><span className="inline-flex items-center gap-2 text-muted-foreground"><span className="h-px w-3 bg-primary" />CPU</span><span className="inline-flex items-center gap-2 text-muted-foreground"><span className="h-px w-3 bg-chart-2" />MEMORY</span></div><div className="flex border border-border/80 p-0.5 text-[8px] font-semibold tracking-[0.13em]"><button type="button" onClick={() => setRange("LIVE")} className={`px-2 py-1.5 transition-colors ${range === "LIVE" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>LIVE</button><button type="button" onClick={() => setRange("1 MIN")} className={`px-2 py-1.5 transition-colors ${range === "1 MIN" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>1 MIN</button></div></div></div>
        <div className="mt-5 h-[285px] w-full" aria-label="CPU and memory usage over time">
          <ResponsiveContainer width="100%" height="100%"><AreaChart data={visibleHistory} margin={{ left: -22, right: 8, top: 10, bottom: 0 }}>
            <defs><linearGradient id="cpuFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--primary)" stopOpacity={0.13} /><stop offset="95%" stopColor="var(--primary)" stopOpacity={0} /></linearGradient><linearGradient id="memoryFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.09} /><stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0} /></linearGradient></defs>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="1 6" /><XAxis dataKey="time" tickLine={false} axisLine={false} minTickGap={30} tick={{ fill: "var(--muted-foreground)", fontSize: 9, letterSpacing: "0.04em" }} /><YAxis domain={[0, 100]} tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 9 }} tickFormatter={(value: number) => `${value}%`} /><Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--foreground)", fontSize: 10 }} formatter={(value: unknown) => [`${Number(value).toFixed(1)}%`]} />
            <Area type="monotone" dataKey="memory" name="Memory" stroke="var(--chart-2)" strokeWidth={1.5} fill="url(#memoryFill)" isAnimationActive={false} /><Area type="monotone" dataKey="cpu" name="CPU" stroke="var(--primary)" strokeWidth={1.7} fill="url(#cpuFill)" isAnimationActive={false} />
          </AreaChart></ResponsiveContainer>
        </div>
        <div className="flex items-center justify-between border-t border-border/65 pt-3"><span className="text-[9px] tracking-[0.1em] text-muted-foreground">AUTO-REFRESH · 4 SEC</span><span className="text-[9px] tracking-[0.1em] text-muted-foreground">{data.source === "mock" ? "DEVELOPMENT DATA" : isFetching ? "UPDATING" : "LIVE DATA"}</span></div>
      </section>

      <section className="border-t border-border/65 pt-5 xl:border-t-0 xl:border-l xl:border-border/65 xl:pl-8 xl:pt-0">
        <p className="eyebrow">MACHINE PROFILE</p><h2 className="mt-2 text-[15px] font-medium tracking-tight">System details</h2>
        <div className="mt-5">
          <DetailRow label="HOSTNAME" value={data.hostname} mono /><DetailRow label="PLATFORM" value={data.platform} /><DetailRow label="PROCESSORS" value={`${data.cpuCores} logical cores`} /><DetailRow label="MEMORY FREE" value={formatBytes(Math.max(0, data.memoryTotal - data.memoryUsed))} /><DetailRow label="DISK FREE" value={formatBytes(Math.max(0, data.storageTotal - data.storageUsed))} /><DetailRow label="UPTIME" value={formatUptime(data.uptimeSeconds)} />
        </div>
        <div className="mt-8 border-l border-primary/65 pl-4"><p className="text-[10px] font-medium tracking-[0.11em]">{data.source === "mock" ? "SIMULATED ENVIRONMENT" : "ALL SYSTEMS RESPONDING"}</p><p className="mt-1.5 text-[10px] leading-5 text-muted-foreground">{data.source === "mock" ? "Development metrics are displayed for this machine." : "Host metrics are being collected from the server."}</p></div>
      </section>
    </div>
    {data.source === "mock" && <p className="border-t border-border/65 pt-4 text-center text-[9px] tracking-[0.1em] text-muted-foreground">MACOS DEVELOPMENT · MOCK METRICS</p>}
  </div>
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return <div className="grid grid-cols-[92px_minmax(0,1fr)] items-baseline gap-3 border-b border-border/55 py-3"><span className="text-[8px] font-medium tracking-[0.12em] text-muted-foreground">{label}</span><span className={`truncate text-right text-[10px] font-medium ${mono ? "font-mono tracking-tight" : ""}`} title={value}>{value}</span></div>
}
