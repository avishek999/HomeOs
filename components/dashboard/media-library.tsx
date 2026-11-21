"use client"

import { useQuery } from "@tanstack/react-query"
import Image from "next/image"
import { useState } from "react"
import type { StorageEntry } from "@/lib/storage/browser"
import { Button } from "@/components/ui/button"

type Kind = "photos" | "movies"
type Listing = { path: string; entries: StorageEntry[]; source: "live" | "mock" }

async function getListing(kind: Kind, folder: string): Promise<Listing> {
  const response = await fetch(`/api/media?kind=${kind}&path=${encodeURIComponent(folder)}`, { cache: "no-store" })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || "This folder could not be opened.")
  return result as Listing
}

function mediaUrl(path: string, preview = false, download = false) { return `/api/media/content?path=${encodeURIComponent(path)}${preview ? "&preview=1" : ""}${download ? "&download=1" : ""}` }
function isHeic(path: string) { return /\.(heic|heif)$/i.test(path) }
function bytes(value: number) {
  if (!value) return "—"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const step = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  return `${(value / 1024 ** step).toFixed(step > 1 ? 1 : 0)} ${units[step]}`
}

export function MediaLibrary({ kind }: { kind: Kind }) {
  const [folder, setFolder] = useState("")
  const [selected, setSelected] = useState<StorageEntry | null>(null)
  const { data, error, isLoading, isFetching, refetch } = useQuery({ queryKey: ["media", kind, folder], queryFn: () => getListing(kind, folder), retry: false })
  const title = kind === "photos" ? "Photo library" : "Movie library"
  const segments = folder ? folder.split("/") : []

  return <div className="page-enter space-y-8 sm:space-y-10">
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border/75 pb-8">
      <div><p className="eyebrow mb-4">HOME SERVER <span className="mx-2 text-border">/</span> {kind.toUpperCase()}</p><h1 className="text-[clamp(2.2rem,5vw,4rem)] leading-none font-semibold tracking-[-0.055em]">{title}</h1><p className="mt-4 text-xs text-muted-foreground">Browsing media already on <code className="font-mono text-foreground/80">/mnt/storage</code>. This library is read-only.</p></div>
      <Button variant="outline" size="sm" className="rounded-sm text-[9px] font-semibold tracking-[0.12em]" onClick={() => void refetch()} disabled={isFetching}>{isFetching ? "REFRESHING" : "REFRESH"}</Button>
    </header>
    <nav className="flex flex-wrap items-center gap-3 border-y border-border/75 py-3" aria-label="Media folder path">
      <button onClick={() => { setFolder(""); setSelected(null) }} className="text-[10px] font-semibold tracking-[0.1em]">STORAGE ROOT</button>
      {segments.map((segment, index) => <span key={`${segment}-${index}`} className="inline-flex items-center gap-3"><span className="text-muted-foreground/50">/</span><button onClick={() => { setFolder(segments.slice(0, index + 1).join("/")); setSelected(null) }} className="text-[10px] tracking-[0.07em]">{segment.toUpperCase()}</button></span>)}
      {data?.source === "mock" && <span className="ml-auto text-[8px] font-semibold tracking-[0.14em] text-primary">DEVELOPMENT DATA</span>}
    </nav>
    {isLoading && <div role="status" aria-label={`Loading ${title}`} className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton aspect-[4/3] rounded-sm" />)}</div>}
    {error && <section className="py-16 text-center"><p className="eyebrow">LIBRARY UNAVAILABLE</p><p className="mt-3 text-sm text-muted-foreground">{error instanceof Error ? error.message : "Try again later."}</p></section>}
    {!isLoading && !error && data && <>
      {selected && kind === "movies" && <section className="border-b border-border/75 pb-6"><div className="mb-3 flex items-center justify-between gap-3"><h2 className="truncate text-sm font-medium">{selected.name}</h2><div className="flex items-center gap-4"><a className="text-[9px] tracking-[0.12em] text-muted-foreground hover:text-foreground" href={mediaUrl(selected.path, false, true)}>DOWNLOAD</a><button className="text-[9px] tracking-[0.12em] text-muted-foreground" onClick={() => setSelected(null)}>CLOSE PLAYER</button></div></div><video key={selected.path} src={mediaUrl(selected.path)} controls preload="metadata" className="max-h-[70vh] w-full bg-black" /></section>}
      {selected && kind === "photos" && <section className="border-b border-border/75 pb-6"><div className="mb-3 flex items-center justify-between gap-3"><h2 className="truncate text-sm font-medium">{selected.name}</h2><div className="flex items-center gap-4"><a className="text-[9px] tracking-[0.12em] text-muted-foreground hover:text-foreground" href={mediaUrl(selected.path)} target="_blank" rel="noreferrer">VIEW FULL SIZE</a><a className="text-[9px] tracking-[0.12em] text-muted-foreground hover:text-foreground" href={mediaUrl(selected.path, false, true)}>DOWNLOAD</a><button className="text-[9px] tracking-[0.12em] text-muted-foreground" onClick={() => setSelected(null)}>CLOSE PREVIEW</button></div></div><div className="relative flex min-h-[70vh] items-center justify-center bg-black/5 p-3 dark:bg-white/5"><Image src={mediaUrl(selected.path, isHeic(selected.path))} alt={selected.name} fill unoptimized sizes="100vw" className="object-contain p-3" /></div><p className="mt-2 text-[10px] text-muted-foreground">{isHeic(selected.path) ? "HEIC is converted to a bounded JPEG preview. Download retrieves the original unchanged file." : "Original image served from read-only storage."}</p></section>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {data.entries.map((entry) => entry.type === "directory" ? <button key={entry.path} onClick={() => { setFolder(entry.path); setSelected(null) }} className="flex aspect-[4/3] flex-col items-start justify-end border border-border/75 bg-card p-4 text-left transition-colors hover:border-primary/50"><span className="eyebrow">FOLDER</span><span className="mt-2 line-clamp-2 text-sm font-medium">{entry.name}</span></button> : <button key={entry.path} onClick={() => setSelected(entry)} className={`group overflow-hidden border text-left transition-colors ${selected?.path === entry.path ? "border-primary" : "border-border/75 hover:border-primary/50"}`}>
          <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-foreground/[0.035]">{kind === "photos" ? <Image src={mediaUrl(entry.path, isHeic(entry.path))} alt={entry.name} fill unoptimized sizes="(min-width: 1280px) 20vw, (min-width: 640px) 33vw, 50vw" className="object-cover transition-transform duration-500 group-hover:scale-[1.03]" /> : <span className="eyebrow">MOVIE</span>}</div>
          <div className="p-3"><p className="truncate text-[11px] font-medium">{entry.name}</p><p className="mt-1 text-[9px] text-muted-foreground">{bytes(entry.size)}</p></div>
        </button>)}
      </div>
      {data.entries.length === 0 && <div className="border-y border-border/75 py-16 text-center"><p className="eyebrow">NO {kind.toUpperCase()} HERE</p><p className="mt-3 text-xs text-muted-foreground">Open a folder to browse its {kind === "photos" ? "images" : "videos"}.</p></div>}
      <p className="border-t border-border/65 pt-3 text-[8px] font-medium tracking-[0.12em] text-muted-foreground">{data.entries.length} ITEMS <span className="mx-2">·</span> READ ONLY</p>
    </>}
  </div>
}
