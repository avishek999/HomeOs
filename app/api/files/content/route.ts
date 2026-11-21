import { createReadStream } from "node:fs"
import path from "node:path"
import { Readable } from "node:stream"
import { NextResponse } from "next/server"
import { requireSession } from "@/lib/auth/session"
import { resolveStorageFile, StoragePathError } from "@/lib/storage/browser"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  if (!(await requireSession())) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } })

  try {
    const relativePath = new URL(request.url).searchParams.get("path") ?? ""
    if (relativePath.length > 1024) return NextResponse.json({ error: "That path is too long." }, { status: 400, headers: { "Cache-Control": "no-store" } })
    const file = await resolveStorageFile(relativePath)
    const filename = encodeURIComponent(path.basename(relativePath))
    const stream = file.size ? Readable.toWeb(createReadStream(file.path)) as ReadableStream : null
    return new Response(stream, { headers: { "Content-Type": "application/octet-stream", "Content-Length": String(file.size), "Content-Disposition": `attachment; filename*=UTF-8''${filename}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } })
  } catch (error) {
    if (error instanceof StoragePathError) return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } })
    return NextResponse.json({ error: "Unable to download this file." }, { status: 500, headers: { "Cache-Control": "no-store" } })
  }
}
