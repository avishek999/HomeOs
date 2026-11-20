import { NextResponse } from "next/server"
import { requireSession } from "@/lib/auth/session"
import { listStorage, StoragePathError } from "@/lib/storage/browser"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const photoExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".heic", ".heif"])
const movieExtensions = new Set([".mp4", ".m4v", ".webm", ".mov", ".ogv"])

export async function GET(request: Request) {
  if (!(await requireSession())) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } })
  const url = new URL(request.url)
  const kind = url.searchParams.get("kind")
  const folder = url.searchParams.get("path") ?? ""
  if (folder.length > 1024 || (kind !== "photos" && kind !== "movies")) return NextResponse.json({ error: "Invalid media request." }, { status: 400 })
  try {
    const listing = await listStorage(folder)
    const extensions = kind === "photos" ? photoExtensions : movieExtensions
    const entries = listing.entries.filter((entry) => entry.type === "directory" || extensions.has(entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase()))
    return NextResponse.json({ ...listing, entries }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    if (error instanceof StoragePathError) return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } })
    return NextResponse.json({ error: "Unable to read this media folder." }, { status: 500, headers: { "Cache-Control": "no-store" } })
  }
}
