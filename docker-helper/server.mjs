import http from "node:http"
import { request as socketRequest } from "node:http"
import { timingSafeEqual, createHash } from "node:crypto"
import { execFile as execFileCallback } from "node:child_process"
import { promisify } from "node:util"
import { lstat, realpath } from "node:fs/promises"
import path from "node:path"

const port = Number(process.env.HOMEOS_DOCKER_HELPER_PORT || 8765)
const secret = process.env.HOMEOS_DOCKER_HELPER_SECRET || ""
const socketPath = process.env.HOMEOS_DOCKER_SOCKET || "/var/run/docker.sock"
const managedLabel = "com.homeos.managed"
const execFile = promisify(execFileCallback)

if (secret.length < 32) throw new Error("HOMEOS_DOCKER_HELPER_SECRET must contain at least 32 characters.")

function authorized(request) {
  const provided = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? ""
  const left = Buffer.from(provided)
  const right = Buffer.from(secret)
  return left.length === right.length && timingSafeEqual(left, right)
}

function json(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" })
  response.end(JSON.stringify(value))
}

function docker(method, pathname, body, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const request = socketRequest({ socketPath, method, path: pathname, headers: body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {} }, (response) => {
      const chunks = []
      let size = 0
      response.on("data", (chunk) => {
        size += chunk.length
        if (size > maxBytes) { response.destroy(new Error("Docker response exceeds the configured limit.")); return }
        chunks.push(chunk)
      })
      response.on("error", reject)
      response.on("end", () => {
        const data = Buffer.concat(chunks)
        const status = response.statusCode ?? 502
        if (status < 200 || status >= 300) return reject(new Error(`Docker returned ${status}.`))
        if (!data.length) return resolve({ status, data, text: "" })
        resolve({ status, data, text: data.toString("utf8") })
      })
    })
    request.setTimeout(15_000, () => request.destroy(new Error("Docker request timed out.")))
    request.on("error", reject)
    if (body) request.write(body)
    request.end()
  })
}

async function managedContainers() {
  const filter = encodeURIComponent(JSON.stringify({ label: [`${managedLabel}=true`] }))
  const result = await docker("GET", `/containers/json?all=1&filters=${filter}`)
  const containers = JSON.parse(result.text)
  if (!Array.isArray(containers)) throw new Error("Unexpected Docker response.")
  return containers.filter((item) => item?.Labels?.[managedLabel] === "true").map((item) => ({
    id: String(item.Id).slice(0, 64),
    name: Array.isArray(item.Names) ? String(item.Names[0] ?? "").replace(/^\//, "") : "managed-container",
    image: String(item.Image ?? "unknown"),
    status: String(item.State ?? "unknown"),
    detail: String(item.Status ?? ""),
    created: Number(item.Created ?? 0),
    deployment: String(item.Labels?.["com.homeos.repo"] ?? ""),
    ports: Array.isArray(item.Ports) ? item.Ports.map((port) => ({ privatePort: port.PrivatePort, publicPort: port.PublicPort, type: port.Type })) : [],
  }))
}

function deploymentConfigs() {
  let entries
  try { entries = JSON.parse(process.env.HOMEOS_GITHUB_REPOSITORIES || "[]") }
  catch { throw new Error("Deployment allow-list is invalid.") }
  if (!Array.isArray(entries)) throw new Error("Deployment allow-list is invalid.")
  return entries.map((item) => {
    if (typeof item?.repo !== "string" || typeof item?.port !== "number") throw new Error("Deployment allow-list is invalid.")
    return { repo: item.repo, port: item.port, slug: createHash("sha256").update(item.repo.toLowerCase()).digest("hex").slice(0, 16) }
  })
}

async function runDocker(args, timeout = 600_000) {
  try {
    const result = await execFile("docker", args, { timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true })
    return result.stdout.trim()
  } catch (error) {
    if (error?.code === "ETIMEDOUT") throw new Error("Docker operation timed out.")
    if (error?.code === "ENOENT") throw new Error("Docker CLI is missing from the isolated helper.")
    throw new Error("Docker operation failed; inspect Docker host logs for details.")
  }
}

async function deployImage({ slug, commit, port }) {
  if (!/^[a-f\d]{16}$/.test(slug) || !/^[a-f\d]{40}$/.test(commit) || !Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid deployment request.")
  const config = deploymentConfigs().find((item) => item.slug === slug && item.port === port)
  if (!config) throw new Error("Repository is outside the configured deployment allow-list.")
  const managedRoot = process.env.HOMEOS_DATA_ROOT
  if (!managedRoot || !path.isAbsolute(managedRoot)) throw new Error("Managed data volume is not configured.")
  const sourcePath = path.join(managedRoot, "deployments", slug, "source")
  const root = await realpath(managedRoot)
  const rootInfo = await lstat(sourcePath).catch(() => null)
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("Deployment source is not a safe directory.")
  const source = await realpath(sourcePath)
  const relative = path.relative(root, source)
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) throw new Error("Deployment source is outside managed storage.")

  const image = `homeos-public:${slug}-${commit.slice(0, 12)}`
  await runDocker(["build", "--tag", image, "--file", "Dockerfile", source])
  const filter = `label=com.homeos.repo-slug=${slug}`
  const oldOutput = await runDocker(["ps", "--all", "--filter", filter, "--format", "{{.Names}}"], 20_000)
  const oldNames = oldOutput.split(/\r?\n/).filter((name) => new RegExp(`^homeos-public-${slug}-[a-f0-9]{12}$`).test(name))
  const newName = `homeos-public-${slug}-${commit.slice(0, 12)}`
  if (oldNames.includes(newName)) return { ok: true, image, container: newName, unchanged: true, port }

  let stopped = []
  try {
    for (const name of oldNames) {
      const state = await runDocker(["inspect", "--format", "{{.State.Running}}", name], 15_000)
      if (state === "true") {
        await runDocker(["stop", "--time", "10", name], 20_000)
        stopped.push(name)
      }
    }
    await runDocker([
      "run", "--detach", "--name", newName,
      "--label", `${managedLabel}=true`, "--label", "com.homeos.public=true",
      "--label", `com.homeos.repo=${config.repo}`, "--label", `com.homeos.repo-slug=${slug}`,
      "--network", "homeos-public", "--publish", `127.0.0.1:${port}:${port}`,
      "--user", "1000:1000", "--init",
      "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
      "--pids-limit", "128", "--memory", "512m", "--cpus", "1.0",
      "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m",
      "--restart", "unless-stopped", "--env", `PORT=${port}`, "--env", "HOST=0.0.0.0", "--env", "HOSTNAME=0.0.0.0",
      image,
    ], 60_000)
    let running = false
    for (let attempt = 0; attempt < 15; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      const state = await runDocker(["inspect", "--format", "{{.State.Running}}", newName], 15_000)
      if (state === "true") { running = true; break }
    }
    if (!running) throw new Error("New application container did not remain running.")
    for (const name of oldNames) await runDocker(["rm", name], 15_000)
    return { ok: true, image, container: newName, unchanged: false, port }
  } catch (error) {
    await runDocker(["rm", "--force", newName], 15_000).catch(() => undefined)
    for (const name of stopped) await runDocker(["start", name], 20_000).catch(() => undefined)
    throw error
  }
}

async function assertManagedContainer(id) {
  if (!/^[a-f\d]{12,64}$/i.test(id)) throw new Error("Invalid container identifier.")
  const result = await docker("GET", `/containers/${id}/json`)
  const container = JSON.parse(result.text)
  if (container?.Config?.Labels?.[managedLabel] !== "true" || container?.Id?.toLowerCase().startsWith(id.toLowerCase()) !== true) {
    throw new Error("Container is outside the HomeOS managed set.")
  }
  return container
}

function redactLogs(text) {
  return text.replace(/\b(password|secret|token|authorization|api[_-]?key)(\s*[:=]\s*|\s+)([^,;\r\n]+)/gi, "$1$2[redacted]")
}

function decodeLogs(buffer) {
  const parts = []
  let offset = 0
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset + 4)
    if (offset + 8 + length > buffer.length) return buffer.toString("utf8")
    parts.push(buffer.subarray(offset + 8, offset + 8 + length))
    offset += 8 + length
  }
  if (offset !== buffer.length) return buffer.toString("utf8")
  return Buffer.concat(parts).toString("utf8")
}

async function readLogs(id) {
  await assertManagedContainer(id)
  const result = await docker("GET", `/containers/${id}/logs?stdout=1&stderr=1&tail=200&timestamps=1`, undefined, 256 * 1024)
  return redactLogs(decodeLogs(result.data).slice(-128 * 1024))
}

async function handle(request, response) {
  if (!authorized(request)) return json(response, 401, { error: "Authentication required." })
  if (Number(request.headers["content-length"] ?? 0) > 1024 || request.headers["transfer-encoding"]) return json(response, 413, { error: "Request is too large." })
  const url = new URL(request.url ?? "/", "http://docker-helper")
  if (!(request.method === "POST" && url.pathname === "/deploy")) request.resume()
  if (request.method === "GET" && url.pathname === "/health") {
    await docker("GET", "/_ping", undefined, 256)
    return json(response, 200, { available: true })
  }
  if (request.method === "GET" && url.pathname === "/containers") {
    return json(response, 200, { containers: await managedContainers() })
  }
  if (request.method === "POST" && url.pathname === "/deploy") {
    const chunks = []
    let size = 0
    for await (const chunk of request) {
      size += chunk.length
      if (size > 2048) return json(response, 413, { error: "Request is too large." })
      chunks.push(chunk)
    }
    let deployment
    try { deployment = JSON.parse(Buffer.concat(chunks).toString("utf8")) }
    catch { return json(response, 400, { error: "Invalid deployment request." }) }
    return json(response, 200, await deployImage(deployment))
  }
  const logsMatch = /^\/containers\/([a-f\d]{12,64})\/logs$/i.exec(url.pathname)
  if (request.method === "GET" && logsMatch) return json(response, 200, { logs: await readLogs(logsMatch[1]) })
  const actionMatch = /^\/containers\/([a-f\d]{12,64})\/(start|stop|restart)$/i.exec(url.pathname)
  if (request.method === "POST" && actionMatch) {
    await assertManagedContainer(actionMatch[1])
    const endpoint = actionMatch[2] === "restart" ? "restart?t=10" : actionMatch[2]
    await docker("POST", `/containers/${actionMatch[1]}/${endpoint}`)
    return json(response, 200, { ok: true })
  }
  return json(response, 404, { error: "Route not found." })
}

const server = http.createServer((request, response) => {
  void handle(request, response).catch((error) => {
    const message = error instanceof Error ? error.message : "Docker helper failure."
    json(response, message.startsWith("Container is outside") ? 403 : 503, { error: message })
  })
})
server.requestTimeout = 20_000
server.headersTimeout = 5_000
server.maxHeadersCount = 32
server.listen(port, "0.0.0.0")
