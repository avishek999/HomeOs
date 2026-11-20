import { NextResponse } from "next/server"
import { requireSession } from "@/lib/auth/session"
import { getSystemMetrics } from "@/lib/system/metrics"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  if (!(await requireSession())) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } })
  }
  try {
    const metrics = await getSystemMetrics()
    return NextResponse.json(metrics, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return NextResponse.json({ error: "System metrics are temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } })
  }
}
