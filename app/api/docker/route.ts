import { NextResponse } from "next/server"
import { loginOriginIsValid, requireSession } from "@/lib/auth/session"
import { getManagedContainerLogs, listManagedContainers, manageContainer } from "@/lib/services/docker"
import { readBoundedText } from "@/lib/server/request-body"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "Docker service is unavailable."
  return NextResponse.json({ error: message }, { status: 503, headers: { "Cache-Control": "no-store" } })
}

export async function GET(request: Request) {
  if (!(await requireSession())) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } })
  try {
    const id = new URL(request.url).searchParams.get("logs")
    return NextResponse.json(id ? { logs: await getManagedContainerLogs(id) } : { containers: await listManagedContainers() }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) { return failure(error) }
}

export async function POST(request: Request) {
  if (!(await requireSession())) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } })
  if (!loginOriginIsValid(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 })
  let payload: unknown
  try {
    const body = await readBoundedText(request, 1024)
    payload = JSON.parse(body)
  } catch (error) { return NextResponse.json({ error: error instanceof Error && error.name === "RequestBodyTooLargeError" ? "Request is too large." : "Invalid request body." }, { status: error instanceof Error && error.name === "RequestBodyTooLargeError" ? 413 : 400 }) }
  const { id, action } = payload as { id?: unknown; action?: unknown }
  if (typeof id !== "string" || !/^[a-f\d]{12,64}$/i.test(id) || (action !== "start" && action !== "stop" && action !== "restart")) {
    return NextResponse.json({ error: "Choose a managed container and a supported action." }, { status: 400 })
  }
  try {
    await manageContainer(id, action)
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) { return failure(error) }
}
