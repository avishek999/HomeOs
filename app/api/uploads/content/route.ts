import { createReadStream } from "node:fs"
import { Readable } from "node:stream"
import { NextResponse } from "next/server"
import { requireSession } from "@/lib/auth/session"
import { StoragePathError } from "@/lib/storage/path-policy"
import { resolveManagedUpload } from "@/lib/storage/managed"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  if (!(await requireSession())) return NextResponse.json({ error: "Authentication required." }, { status: 401 })
  try {
    const name = new URL(request.url).searchParams.get("name") ?? ""
    const file = await resolveManagedUpload(name)
    const stream = file.size ? Readable.toWeb(createReadStream(file.path)) as ReadableStream : null
    return new Response(stream, { headers: { "Content-Type": "application/octet-stream", "Content-Length": String(file.size), "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } })
  } catch (error) {
    if (error instanceof StoragePathError) return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } })
    return NextResponse.json({ error: "Unable to download this file." }, { status: 500, headers: { "Cache-Control": "no-store" } })
  }
}
