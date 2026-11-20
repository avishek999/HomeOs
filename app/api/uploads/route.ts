import { NextResponse } from "next/server"
import { loginOriginIsValid, requireSession } from "@/lib/auth/session"
import { StoragePathError } from "@/lib/storage/path-policy"
import { listManagedUploads, maxManagedUploadBytes, storeManagedUpload } from "@/lib/storage/managed"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
const MAX_REQUEST_BYTES = maxManagedUploadBytes + 512 * 1024
let activeUploads = 0

export async function GET() {
  if (!(await requireSession())) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } })
  try {
    return NextResponse.json({ items: await listManagedUploads() }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    if (error instanceof StoragePathError) return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } })
    return NextResponse.json({ error: "Unable to read managed storage." }, { status: 500, headers: { "Cache-Control": "no-store" } })
  }
}

export async function POST(request: Request) {
  if (!(await requireSession())) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } })
  if (!loginOriginIsValid(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 })
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data;")) return NextResponse.json({ error: "Use a multipart file upload." }, { status: 415 })
  if (activeUploads >= 2) return NextResponse.json({ error: "Another upload is in progress. Try again shortly." }, { status: 429 })
  activeUploads += 1
  try {
    const chunks: Uint8Array[] = []
    let totalBytes = 0
    const reader = request.body?.getReader()
    if (!reader) return NextResponse.json({ error: "The upload body is empty." }, { status: 400 })
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_REQUEST_BYTES) {
        await reader.cancel()
        return NextResponse.json({ error: "Upload exceeds the 25 MB limit." }, { status: 413 })
      }
      chunks.push(value)
    }
    const boundedRequest = new Request(request.url, { method: "POST", headers: request.headers, body: Buffer.concat(chunks) })
    const form = await boundedRequest.formData()
    const file = form.get("file")
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose one file to upload." }, { status: 400 })
    const result = await storeManagedUpload(file)
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    if (error instanceof StoragePathError) return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } })
    return NextResponse.json({ error: "The upload could not be saved." }, { status: 500, headers: { "Cache-Control": "no-store" } })
  } finally {
    activeUploads -= 1
  }
}
