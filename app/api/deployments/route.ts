import { NextResponse } from "next/server"
import { loginOriginIsValid, requireSession } from "@/lib/auth/session"
import { deploymentConfigs, deployGithubRepository, finishDeploymentRecord, listDeploymentHistory, startDeploymentRecord } from "@/lib/deployments/github"
import { listManagedContainers } from "@/lib/services/docker"
import type { ManagedContainer } from "@/lib/services/docker"
import { readBoundedText } from "@/lib/server/request-body"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
const active = new Set<string>()

export async function GET() {
  if (!(await requireSession())) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } })
  try {
    const repositories = deploymentConfigs()
    const history = listDeploymentHistory()
    let containers: ManagedContainer[] = []
    try { containers = await listManagedContainers() }
    catch { /* Deployments and history remain visible while the helper is offline. */ }
    const apps = repositories.map((repo) => ({
      ...repo,
      latest: history.find((run) => run.repository.toLowerCase() === repo.repo.toLowerCase()) ?? null,
      running: containers.some((container) => container.deployment?.toLowerCase() === repo.repo.toLowerCase() && container.status === "running"),
    }))
    return NextResponse.json({ apps, configured: Boolean(process.env.HOMEOS_GITHUB_TOKEN), history }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return NextResponse.json({ error: "Deployment configuration is invalid." }, { status: 503, headers: { "Cache-Control": "no-store" } })
  }
}

export async function POST(request: Request) {
  if (!(await requireSession())) return NextResponse.json({ error: "Authentication required." }, { status: 401, headers: { "Cache-Control": "no-store" } })
  if (!loginOriginIsValid(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 })
  let repo: unknown
  try {
    const body = await readBoundedText(request, 1024)
    repo = (JSON.parse(body) as { repo?: unknown }).repo
  } catch (error) { return NextResponse.json({ error: error instanceof Error && error.name === "RequestBodyTooLargeError" ? "Request is too large." : "Invalid request body." }, { status: error instanceof Error && error.name === "RequestBodyTooLargeError" ? 413 : 400 }) }
  if (typeof repo !== "string") return NextResponse.json({ error: "Choose an allow-listed repository." }, { status: 400 })
  let config
  try { config = deploymentConfigs().find((item) => item.repo.toLowerCase() === repo.toLowerCase()) }
  catch { return NextResponse.json({ error: "Deployment configuration is invalid." }, { status: 503 }) }
  if (!config) return NextResponse.json({ error: "That repository is not allow-listed." }, { status: 403 })
  if (active.has(config.repo.toLowerCase())) return NextResponse.json({ error: "A deployment is already running for this repository." }, { status: 409 })
  active.add(config.repo.toLowerCase())
  const runId = startDeploymentRecord(config)
  try {
    const deployment = await deployGithubRepository(config.repo)
    finishDeploymentRecord(runId, "succeeded", `Deployed commit ${deployment.commitSha.slice(0, 12)} to loopback port ${deployment.port}.`, deployment.commitSha)
    return NextResponse.json({ deployment }, { status: 201, headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    const summary = error instanceof Error ? error.message : "Deployment failed."
    finishDeploymentRecord(runId, "failed", summary)
    return NextResponse.json({ error: summary, runId }, { status: 503, headers: { "Cache-Control": "no-store" } })
  } finally { active.delete(config.repo.toLowerCase()) }
}
