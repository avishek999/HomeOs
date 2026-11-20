"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRef, useState } from "react"
import { Button } from "@/components/ui/button"

type UploadItem = { name: string; size: number; modifiedAt: string }
type UploadListing = { items: UploadItem[] }

async function getUploads(): Promise<UploadListing> {
  const response = await fetch("/api/uploads", { cache: "no-store" })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || "Unable to read managed storage.")
  return result as UploadListing
}

function formatSize(size: number) {
  if (!size) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const step = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1)
  return `${(size / 1024 ** step).toFixed(step > 1 ? 1 : 0)} ${units[step]}`
}

export function CloudStorage() {
  const input = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState("")
  const queryClient = useQueryClient()
  const listing = useQuery({ queryKey: ["managed-uploads"], queryFn: getUploads, retry: false })
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData()
      form.set("file", file)
      const response = await fetch("/api/uploads", { method: "POST", body: form })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || "Upload failed.")
      return result as UploadItem
    },
    onSuccess: async (result) => { setMessage(`${result.name} uploaded.`); await queryClient.invalidateQueries({ queryKey: ["managed-uploads"] }) },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Upload failed."),
  })

  return <div className="page-enter space-y-8 sm:space-y-10">
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border/75 pb-8"><div><p className="eyebrow mb-4">HOME SERVER <span className="mx-2 text-border">/</span> PERSONAL CLOUD</p><h1 className="text-[clamp(2.2rem,5vw,4rem)] leading-none font-semibold tracking-[-0.055em]">Cloud storage</h1><p className="mt-4 max-w-xl text-xs leading-5 text-muted-foreground">Private uploads are stored on a separate HomeOS data volume. Existing files are never overwritten or changed.</p></div><Button onClick={() => input.current?.click()} disabled={upload.isPending} className="rounded-sm text-[9px] font-semibold tracking-[0.12em]">{upload.isPending ? "UPLOADING" : "UPLOAD FILE"}</Button><input ref={input} type="file" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.currentTarget.value = "" }} aria-label="Choose a file to upload" /></header>
    <p role="status" className="min-h-5 text-xs text-muted-foreground">{message || "Maximum file size: 25 MB. Uploads do not replace existing files."}</p>
    {listing.isLoading && <div className="space-y-3" role="status" aria-label="Loading uploads">{[1, 2, 3].map((item) => <div key={item} className="skeleton h-10 rounded-sm" />)}</div>}
    {listing.error && <section className="border-y border-border/75 py-12 text-center"><p className="eyebrow">MANAGED VOLUME NOT READY</p><p className="mx-auto mt-3 max-w-xl text-xs leading-5 text-muted-foreground">{listing.error instanceof Error ? listing.error.message : "Configure HOMEOS_DATA_ROOT as a separate mounted volume, then restart HomeOS."}</p><Button variant="outline" size="sm" className="mt-5 rounded-sm text-[9px] tracking-[0.12em]" onClick={() => void listing.refetch()}>RETRY</Button></section>}
    {listing.data && <section><div className="grid grid-cols-[minmax(0,1fr)_90px_120px] border-b border-border/65 py-3 text-[8px] font-semibold tracking-[0.17em] text-muted-foreground"><span>NAME</span><span>SIZE</span><span className="text-right">ADDED</span></div>{listing.data.items.map((item) => <div key={item.name} className="grid grid-cols-[minmax(0,1fr)_90px_120px] items-center gap-2 border-b border-border/45 py-4 text-[10px]"><span className="truncate font-medium">{item.name}</span><span className="text-muted-foreground">{formatSize(item.size)}</span><span className="text-right text-muted-foreground">{new Date(item.modifiedAt).toLocaleDateString()}</span><a className="col-span-3 text-[8px] font-semibold tracking-[0.12em] text-primary hover:underline" href={`/api/uploads/content?name=${encodeURIComponent(item.name)}`}>DOWNLOAD</a></div>)}{listing.data.items.length === 0 && <div className="border-b border-border/75 py-14 text-center"><p className="eyebrow">NO UPLOADS YET</p><p className="mt-3 text-xs text-muted-foreground">Choose Upload File to add a private file.</p></div>}</section>}
  </div>
}
