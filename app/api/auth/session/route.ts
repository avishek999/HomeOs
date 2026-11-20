import { NextResponse } from "next/server"
import { requireSession } from "@/lib/auth/session"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  if (!(await requireSession())) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } })
  }
  return NextResponse.json({ authenticated: true }, { headers: { "Cache-Control": "no-store" } })
}
