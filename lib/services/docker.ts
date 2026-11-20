import "server-only"

export type ManagedContainer = { id: string; name: string; image: string; status: string; detail: string; created: number; deployment?: string; ports: Array<{ privatePort: number; publicPort?: number; type: string }> }

function helperConfig() {
  const base = process.env.HOMEOS_DOCKER_HELPER_URL
  const secret = process.env.HOMEOS_DOCKER_HELPER_SECRET
  if (!base || !secret || secret.length < 32) throw new Error("Docker management is not configured.")
  const url = new URL(base)
  if (url.protocol !== "http:" || url.hostname !== "docker-helper") throw new Error("Docker helper must use the private Compose control network.")
  return { base: url, secret }
}

async function helperFetch(path: string, init?: RequestInit) {
  const { base, secret } = helperConfig()
  const url = new URL(path, base)
  const response = await fetch(url, { ...init, cache: "no-store", signal: init?.signal ?? AbortSignal.timeout(20_000), headers: { ...init?.headers, Authorization: `Bearer ${secret}` } })
  const result = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) throw new Error(result.error || "Docker helper is unavailable.")
  return result
}

export async function listManagedContainers() {
  const result = await helperFetch("/containers") as { containers?: unknown }
  if (!Array.isArray(result.containers)) throw new Error("Docker helper returned an invalid container list.")
  return result.containers as ManagedContainer[]
}

export async function manageContainer(id: string, action: "start" | "stop" | "restart") {
  if (!/^[a-f\d]{12,64}$/i.test(id)) throw new Error("Invalid container identifier.")
  await helperFetch(`/containers/${id}/${action}`, { method: "POST" })
}

export async function deployManagedImage(deployment: { slug: string; commit: string; port: number }) {
  if (!/^[a-f\d]{16}$/.test(deployment.slug) || !/^[a-f\d]{40}$/.test(deployment.commit) || !Number.isInteger(deployment.port)) throw new Error("Invalid deployment request.")
  return helperFetch("/deploy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(deployment), signal: AbortSignal.timeout(12 * 60_000) })
}

export async function getManagedContainerLogs(id: string) {
  if (!/^[a-f\d]{12,64}$/i.test(id)) throw new Error("Invalid container identifier.")
  const result = await helperFetch(`/containers/${id}/logs`) as { logs?: unknown }
  if (typeof result.logs !== "string") throw new Error("Docker helper returned invalid logs.")
  return result.logs
}
