import { createReadStream } from "node:fs"
import { Readable } from "node:stream"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { execFile as execFileCallback } from "node:child_process"
import { promisify } from "node:util"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import { NextResponse } from "next/server"
import { requireSession } from "@/lib/auth/session"
import { resolveStorageFile, StoragePathError } from "@/lib/storage/browser"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const mediaTypes: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif",
  ".heic": "image/heic", ".heif": "image/heif",
  ".mp4": "video/mp4", ".m4v": "video/mp4", ".webm": "video/webm",
  ".mov": "video/quicktime", ".ogv": "video/ogg",
}
const execFile = promisify(execFileCallback)

function failure(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } })
}

export async function GET(request: Request) {
  if (!(await requireSession())) return failure("Authentication required.", 401)
  const relativePath = new URL(request.url).searchParams.get("path") ?? ""
  if (relativePath.length > 1024) return failure("That path is too long.", 400)
  const type = mediaTypes[path.extname(relativePath).toLowerCase()]
  if (!type) return failure("That file type cannot be previewed.", 415)

  try {
    const file = await resolveStorageFile(relativePath)
    const preview = new URL(request.url).searchParams.get("preview") === "1"
    const download = new URL(request.url).searchParams.get("download") === "1"
    const disposition = download ? `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(relativePath))}` : "inline"
    if (preview && (type === "image/heic" || type === "image/heif")) {
      if (file.size > 100 * 1024 * 1024) return failure("This HEIC image exceeds the 100 MB preview limit.", 413)
      const temporary = await mkdtemp(path.join(os.tmpdir(), `homeos-heic-${randomUUID()}-`))
      try {
        const convertedPath = path.join(temporary, "preview.jpg")
        await execFile("heif-convert", ["-q", "86", file.path, convertedPath], { timeout: 20_000, maxBuffer: 64 * 1024, windowsHide: true })
        const sharp = (await import("sharp")).default
        const converted = await sharp(await readFile(convertedPath), { limitInputPixels: 100_000_000, sequentialRead: true })
          .rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 86, mozjpeg: true }).toBuffer()
        return new Response(new Uint8Array(converted), { status: 200, headers: { "Content-Type": "image/jpeg", "Content-Length": String(converted.length), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": disposition } })
      } finally { await rm(temporary, { recursive: true, force: true }) }
    }
    if (file.size === 0) return new Response(null, { status: 200, headers: { "Content-Type": type, "Content-Length": "0", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } })
    const range = request.headers.get("range")
    let start = 0
    let end = file.size - 1
    let status = 200
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (!match || file.size === 0) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${file.size}`, "Cache-Control": "no-store" } })
      if (match[1] === "") {
        const suffixLength = Number(match[2])
        if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return new Response(null, { status: 416 })
        start = Math.max(0, file.size - suffixLength)
      } else {
        start = Number(match[1])
        if (match[2] !== "") end = Number(match[2])
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= file.size) {
        return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${file.size}`, "Cache-Control": "no-store" } })
      }
      end = Math.min(end, file.size - 1)
      status = 206
    }
    const stream = createReadStream(file.path, { start, end })
    const headers = new Headers({
      "Content-Type": type,
      "Content-Length": String(Math.max(0, end - start + 1)),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": disposition,
    })
    if (status === 206) headers.set("Content-Range", `bytes ${start}-${end}/${file.size}`)
    return new Response(Readable.toWeb(stream) as ReadableStream, { status, headers })
  } catch (error) {
    if (error instanceof StoragePathError) return failure(error.message, error.status)
    return failure("Unable to preview this file.", 500)
  }
}
