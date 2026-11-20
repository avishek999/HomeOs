import { NextResponse } from "next/server"
import { requireSession } from "@/lib/auth/session"
import { listStorage, StoragePathError } from "@/lib/storage/browser"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  if (!(await requireSession())) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } })
  }
  const relativePath = new URL(request.url).searchParams.get("path") ?? ""
  if (relativePath.length > 1024) {
    return NextResponse.json({ error: "That path is too long." }, { status: 400 })
  }
  try {
    return NextResponse.json(await listStorage(relativePath), { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    if (error instanceof StoragePathError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } })
    }
    return NextResponse.json({ error: "Unable to read this folder." }, { status: 500, headers: { "Cache-Control": "no-store" } })
  }
}
