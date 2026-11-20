import "server-only"

import { createHash, randomUUID } from "node:crypto"
import { chmod, mkdir, open, realpath, rename, rm } from "node:fs/promises"
import path from "node:path"
import { StoragePathError, isInsideStorageRoot } from "@/lib/storage/path-policy"
import { resolveManagedDirectory } from "@/lib/storage/managed"
import { deployManagedImage } from "@/lib/services/docker"
import { getNativeDatabase } from "@/lib/db"

export type GithubDeploymentConfig = { repo: string; ref: string; port: number }
const MAX_REPOSITORIES = 20
const MAX_TREE_FILES = 2000
const MAX_FILE_BYTES = 8 * 1024 * 1024
const MAX_SOURCE_BYTES = 80 * 1024 * 1024

export function deploymentConfigs(): GithubDeploymentConfig[] {
  const raw = process.env.HOMEOS_GITHUB_REPOSITORIES
  if (!raw) return []
  let config: unknown
  try { config = JSON.parse(raw) } catch { throw new Error("HOMEOS_GITHUB_REPOSITORIES must be valid JSON.") }
  if (!Array.isArray(config) || config.length > MAX_REPOSITORIES) throw new Error("HOMEOS_GITHUB_REPOSITORIES must contain at most 20 repositories.")
  const repos = new Set<string>()
  const ports = new Set<number>()
  return config.map((entry) => {
    const item = entry as { repo?: unknown; ref?: unknown; port?: unknown }
    if (typeof item?.repo !== "string" || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(item.repo) || item.repo.includes("..")) throw new Error("Each allowed repository must use the owner/name form.")
    if (typeof item.ref !== "string" || !/^[A-Za-z0-9._/-]{1,100}$/.test(item.ref) || item.ref.startsWith("/") || item.ref.split("/").some((part) => part === ".." || part === ".")) throw new Error(`Invalid Git ref for ${item.repo}.`)
    if (!Number.isInteger(item.port) || (item.port as number) < 1024 || (item.port as number) > 65535) throw new Error(`Invalid loopback port for ${item.repo}.`)
    if (repos.has(item.repo.toLowerCase()) || ports.has(item.port as number)) throw new Error("Allowed GitHub repositories and ports must be unique.")
    repos.add(item.repo.toLowerCase()); ports.add(item.port as number)
    return { repo: item.repo, ref: item.ref, port: item.port as number }
  })
}

export function deploymentSlug(repo: string) {
  return createHash("sha256").update(repo.toLowerCase()).digest("hex").slice(0, 16)
}

function githubHeaders(accept = "application/vnd.github+json") {
  const token = process.env.HOMEOS_GITHUB_TOKEN
  if (!token || token.length < 20) throw new Error("GitHub deployments are disabled until HOMEOS_GITHUB_TOKEN is configured.")
  return { Authorization: `Bearer ${token}`, Accept: accept, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "HomeOS" }
}

async function githubJson(url: URL) {
  if (url.hostname !== "api.github.com" || url.protocol !== "https:") throw new Error("GitHub API URL is not allowed.")
  const response = await fetch(url, { headers: githubHeaders(), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(response.status === 404 ? "Repository or branch not found, or token lacks access." : response.status === 403 ? "GitHub API rate limit or token permission denied." : `GitHub API returned ${response.status}.`)
  const length = Number(response.headers.get("content-length") ?? 0)
  if (length > 12 * 1024 * 1024) throw new Error("GitHub API response is too large.")
  return response.json() as Promise<Record<string, unknown>>
}

async function saveBlob(repo: string, sha: string, target: string, expectedSize: number) {
  const [owner, name] = repo.split("/")
  const url = new URL(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/blobs/${encodeURIComponent(sha)}`)
  const data = await githubJson(url)
  if (data.encoding !== "base64" || typeof data.content !== "string") throw new Error("GitHub returned an invalid file blob.")
  const bytes = Buffer.from(data.content.replace(/\s/g, ""), "base64")
  if (bytes.length !== expectedSize || bytes.length > MAX_FILE_BYTES) throw new Error("Repository file failed its size check.")
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 })
  const handle = await open(target, "wx", 0o600)
  try { await handle.writeFile(bytes); await handle.sync() }
  finally { await handle.close() }
}

async function downloadTree(config: GithubDeploymentConfig, destination: string) {
  const [owner, name] = config.repo.split("/")
  const commit = await githubJson(new URL(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${encodeURIComponent(config.ref)}`))
  const commitSha = (commit.sha as string | undefined) ?? ""
  if (!/^[a-f\d]{40}$/i.test(commitSha)) throw new Error("GitHub returned an invalid commit identifier.")
  const treeResponse = await githubJson(new URL(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/trees/${commitSha}?recursive=1`))
  if (treeResponse.truncated === true || !Array.isArray(treeResponse.tree)) throw new Error("Repository tree is too large or incomplete.")
  const entries = (treeResponse.tree as Array<{ path?: unknown; mode?: unknown; type?: unknown; sha?: unknown; size?: unknown }>).filter((entry) => entry.type === "blob")
  if (entries.length > MAX_TREE_FILES) throw new Error("Repository exceeds the 2,000 file deployment limit.")
  let totalBytes = 0
  const files = entries.map((entry) => {
    if (typeof entry.path !== "string" || typeof entry.sha !== "string" || !/^[a-f\d]{40}$/i.test(entry.sha) || typeof entry.size !== "number" || !Number.isSafeInteger(entry.size)) throw new Error("Repository tree contains an invalid file record.")
    const parts = entry.path.split("/")
    if (entry.path.startsWith("/") || entry.path.includes("\\") || entry.path.includes("\0") || parts.some((part) => !part || part === "." || part === ".." || part.includes(":"))) throw new Error("Repository contains an unsafe path.")
    if (entry.mode !== "100644" && entry.mode !== "100755") throw new Error("Repository symlinks and submodules cannot be deployed.")
    if (entry.size < 0 || entry.size > MAX_FILE_BYTES) throw new Error("A repository file exceeds the 8 MB file limit.")
    totalBytes += entry.size
    return { path: entry.path, sha: entry.sha, size: entry.size, executable: entry.mode === "100755" }
  })
  if (totalBytes > MAX_SOURCE_BYTES) throw new Error("Repository exceeds the 80 MB source limit.")

  let cursor = 0
  const workers = Array.from({ length: Math.min(4, files.length) }, async () => {
    while (cursor < files.length) {
      const entry = files[cursor++]
      const target = path.join(destination, ...entry.path.split("/"))
      await saveBlob(config.repo, entry.sha, target, entry.size)
      if (entry.executable) await chmod(target, 0o700)
    }
  })
  await Promise.all(workers)
  return { commitSha, fileCount: files.length, totalBytes }
}

export async function deployGithubRepository(repo: string) {
  const config = deploymentConfigs().find((item) => item.repo.toLowerCase() === repo.toLowerCase())
  if (!config) throw new StoragePathError("That repository is not on the HomeOS allow-list.", 403)
  const slug = deploymentSlug(config.repo)
  const { root, path: deploymentRoot } = await resolveManagedDirectory("deployments", true)
  const stageName = `.source-${slug}-${randomUUID()}`
  const stagePath = path.join(deploymentRoot, stageName)
  const sourcePath = path.join(deploymentRoot, slug, "source")
  await mkdir(stagePath, { mode: 0o700 })
  let oldPath: string | null = null
  let published = false
  try {
    const source = await downloadTree(config, stagePath)
    const repoPath = path.join(deploymentRoot, slug)
    await mkdir(repoPath, { recursive: true, mode: 0o700 })
    if (!isInsideStorageRoot(root, repoPath) || !isInsideStorageRoot(root, stagePath)) throw new StoragePathError("Deployment source escaped managed storage.", 403)
    const actualRepo = await realpath(repoPath)
    if (!isInsideStorageRoot(root, actualRepo)) throw new StoragePathError("Deployment directory escaped managed storage.", 403)
    const previous = await realpath(sourcePath).catch(() => null)
    if (previous) {
      if (!isInsideStorageRoot(root, previous)) throw new StoragePathError("Existing deployment source is outside managed storage.", 403)
      oldPath = path.join(repoPath, `.previous-${randomUUID()}`)
      await rename(previous, oldPath)
    }
    await rename(stagePath, sourcePath)
    published = true
    await deployManagedImage({ slug, commit: source.commitSha, port: config.port })
    if (oldPath) await rm(oldPath, { recursive: true, force: true })
    return { repo: config.repo, ref: config.ref, port: config.port, ...source, deployedAt: new Date().toISOString() }
  } catch (error) {
    if (published) await rm(sourcePath, { recursive: true, force: true }).catch(() => undefined)
    await rm(stagePath, { recursive: true, force: true }).catch(() => undefined)
    if (oldPath) await rename(oldPath, sourcePath).catch(() => undefined)
    throw error
  }
}

export function startDeploymentRecord(config: GithubDeploymentConfig) {
  const id = randomUUID()
  getNativeDatabase().prepare("INSERT INTO deployment_history (id, repository, ref, port, status, started_at) VALUES (?, ?, ?, ?, 'running', ?)").run(id, config.repo, config.ref, config.port, Date.now())
  return id
}

export function finishDeploymentRecord(id: string, status: "succeeded" | "failed", summary: string, commitSha?: string) {
  getNativeDatabase().prepare("UPDATE deployment_history SET status = ?, summary = ?, commit_sha = ?, completed_at = ? WHERE id = ?").run(status, summary.slice(0, 300), commitSha ?? null, Date.now(), id)
}

export type DeploymentHistory = { id: string; repository: string; ref: string; commitSha: string | null; port: number; status: string; summary: string | null; startedAt: number; completedAt: number | null }

export function listDeploymentHistory(): DeploymentHistory[] {
  return getNativeDatabase().prepare("SELECT id, repository, ref, commit_sha AS commitSha, port, status, summary, started_at AS startedAt, completed_at AS completedAt FROM deployment_history ORDER BY started_at DESC LIMIT 100").all() as DeploymentHistory[]
}
