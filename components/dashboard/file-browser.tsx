"use client"

import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import type { StorageEntry } from "@/lib/storage/browser"

type Listing = { path: string; entries: StorageEntry[]; source: "live" | "mock" }

async function fetchFiles(pathname: string): Promise<Listing> {
  const response = await fetch(`/api/files?path=${encodeURIComponent(pathname)}`, { cache: "no-store" })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || "This folder could not be opened.")
  return result as Listing
}

function formatBytes(bytes: number) {
  if (!bytes) return "—"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const tier = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** tier).toFixed(tier > 1 ? 1 : 0)} ${units[tier]}`
}

export function FileBrowser() {
  const [currentPath, setCurrentPath] = useState("")
  const { data, error, isLoading, isFetching, refetch } = useQuery({ queryKey: ["storage-list", currentPath], queryFn: () => fetchFiles(currentPath), retry: false })
  const segments = currentPath ? currentPath.split("/") : []

  return <div className="page-enter space-y-8 sm:space-y-10">
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border/75 pb-8"><div><p className="eyebrow mb-4">HOME SERVER <span className="mx-2 text-border">/</span> STORAGE</p><h1 className="text-[clamp(2.2rem,5vw,4rem)] leading-none font-semibold tracking-[-0.055em]">Storage</h1><p className="mt-4 text-[12px] tracking-[0.02em] text-muted-foreground">A read-only view of <code className="font-mono text-foreground/80">/mnt/storage</code></p></div><Button variant="outline" size="sm" className="rounded-sm text-[9px] font-semibold tracking-[0.12em]" onClick={() => void refetch()} disabled={isFetching}>{isFetching ? "REFRESHING" : "REFRESH"}</Button></div>

    <section>
      <div className="flex min-h-[54px] flex-wrap items-center gap-x-3 gap-y-1 border-y border-border/75 py-3">
        <button onClick={() => setCurrentPath("")} className={`text-[10px] font-semibold tracking-[0.1em] transition-colors ${segments.length ? "text-muted-foreground hover:text-foreground" : "text-foreground"}`}>STORAGE ROOT</button>
        {segments.map((segment, index) => <span key={`${segment}-${index}`} className="inline-flex items-center gap-3"><span className="text-[9px] text-muted-foreground/50">/</span><button onClick={() => setCurrentPath(segments.slice(0, index + 1).join("/"))} className={`max-w-36 truncate text-[10px] font-medium tracking-[0.07em] transition-colors ${index === segments.length - 1 ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{segment.toUpperCase()}</button></span>)}
        {data?.source === "mock" && <span className="ml-auto text-[8px] font-semibold tracking-[0.14em] text-primary">DEVELOPMENT DATA</span>}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_90px] border-b border-border/65 py-3 text-[8px] font-semibold tracking-[0.17em] text-muted-foreground sm:grid-cols-[minmax(0,1fr)_120px_155px]"><span>NAME</span><span className="text-right sm:text-left">SIZE</span><span className="hidden text-right sm:block">MODIFIED</span></div>
      {isLoading && <div className="space-y-4 py-5" role="status" aria-label="Loading files">{[0, 1, 2, 3, 4].map((item) => <div key={item} className="skeleton h-7 w-full rounded-sm" />)}</div>}
      {error && <div className="border-b border-border/65 py-16 text-center"><p className="eyebrow">STORAGE UNAVAILABLE</p><h2 className="mt-4 text-lg font-medium tracking-tight">This folder can’t be opened</h2><p className="mx-auto mt-2 max-w-md text-xs leading-5 text-muted-foreground">{error instanceof Error ? error.message : "Check the storage mount and try again."}</p><Button className="mt-5 rounded-sm text-[9px] tracking-[0.12em]" size="sm" variant="outline" onClick={() => void refetch()}>TRY AGAIN</Button></div>}
      {!isLoading && !error && data?.entries.length === 0 && <div className="border-b border-border/65 py-16 text-center"><p className="eyebrow">EMPTY DIRECTORY</p><p className="mt-3 text-xs text-muted-foreground">There are no items in this folder.</p></div>}
      {!isLoading && !error && data?.entries.map((entry: StorageEntry, index: number) => <FileRow key={entry.path} entry={entry} index={index} onOpen={() => setCurrentPath(entry.path)} />)}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/75 py-3 text-[8px] font-medium tracking-[0.12em] text-muted-foreground"><span>{data?.entries.length ?? 0} ITEMS</span><span>READ ONLY · NO FILE CONTENT IS SERVED</span></div>
    </section>
  </div>
}

function FileRow({ entry, index, onOpen }: { entry: StorageEntry; index: number; onOpen: () => void }) {
  const isDirectory = entry.type === "directory"
  const rowClass = "grid w-full grid-cols-[minmax(0,1fr)_90px] items-center gap-3 border-b border-border/45 py-3 text-left transition-colors sm:grid-cols-[minmax(0,1fr)_120px_155px] sm:py-3.5"
  const content = <><div className="flex min-w-0 items-baseline gap-3"><span className={`w-[50px] shrink-0 text-[7px] font-semibold tracking-[0.13em] ${isDirectory ? "text-primary" : "text-muted-foreground"}`}>{isDirectory ? "FOLDER" : "FILE"}</span><span className={`truncate text-[11px] font-medium tracking-[0.01em] ${isDirectory ? "text-foreground" : "text-foreground/75"}`}>{entry.name}</span></div><span className="text-right text-[10px] tabular-nums text-muted-foreground sm:text-left">{isDirectory ? "—" : formatBytes(entry.size)}</span><span className="hidden text-right text-[9px] tabular-nums tracking-[0.03em] text-muted-foreground sm:block">{new Date(entry.modifiedAt).toLocaleDateString()}</span></>
  const itemStyle = { animationDelay: `${Math.min(index * 25, 150)}ms` }
  return isDirectory ? <button type="button" onClick={onOpen} style={itemStyle} className={`file-enter ${rowClass} hover:bg-foreground/[0.025]`} aria-label={`Open folder ${entry.name}`}>{content}</button> : <div style={itemStyle} className={`file-enter ${rowClass}`}>{content}</div>
}
