import { constants } from "node:fs"
import { access, lstat, realpath } from "node:fs/promises"
import path from "node:path"

function inside(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}

export async function validateProductionEnvironment(env = process.env, uid = process.getuid?.(), cwd = process.cwd()) {
  if (uid === 0) throw new Error("HomeOS must run as an unprivileged user, never root.")
  const [salt, hash, extra] = (env.HOMEOS_PASSWORD_HASH || "").split(":")
  if (!salt || !hash || extra || !/^[a-f\d]{32,128}$/i.test(salt) || !/^[a-f\d]{128}$/i.test(hash)) {
    throw new Error("Set HOMEOS_PASSWORD_HASH to a valid scrypt hash before production start.")
  }
  if ((env.HOMEOS_SESSION_SECRET || "").length < 32) throw new Error("Set HOMEOS_SESSION_SECRET to at least 32 characters before production start.")
  if (env.HOMEOS_DOCKER_HELPER_URL && (env.HOMEOS_DOCKER_HELPER_SECRET || "").length < 32) throw new Error("Set HOMEOS_DOCKER_HELPER_SECRET to at least 32 characters when the Docker helper is enabled.")
  if (env.HOMEOS_GITHUB_REPOSITORIES) {
    let repositories
    try { repositories = JSON.parse(env.HOMEOS_GITHUB_REPOSITORIES) } catch { throw new Error("HOMEOS_GITHUB_REPOSITORIES must be valid JSON.") }
    if (!Array.isArray(repositories) || repositories.length > 20) throw new Error("HOMEOS_GITHUB_REPOSITORIES must be a JSON array of at most 20 repositories.")
    if (repositories.length && !env.HOMEOS_GITHUB_TOKEN) throw new Error("Set HOMEOS_GITHUB_TOKEN when the repository allow-list is not empty.")
    const names = new Set()
    const ports = new Set()
    for (const item of repositories) {
      if (typeof item?.repo !== "string" || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(item.repo) || item.repo.includes("..")) throw new Error("Each deployment repository must use the owner/name form.")
      if (typeof item.ref !== "string" || !/^[A-Za-z0-9._/-]{1,100}$/.test(item.ref) || item.ref.startsWith("/") || item.ref.split("/").some((part) => part === ".." || part === ".")) throw new Error(`Invalid deployment ref for ${item.repo}.`)
      if (!Number.isInteger(item.port) || item.port < 1024 || item.port > 65535 || names.has(item.repo.toLowerCase()) || ports.has(item.port)) throw new Error("Deployment repositories and ports must be valid and unique.")
      names.add(item.repo.toLowerCase()); ports.add(item.port)
    }
  }
  if (env.HOMEOS_BACKUP_ENABLED !== undefined && !["true", "false"].includes(env.HOMEOS_BACKUP_ENABLED)) throw new Error("HOMEOS_BACKUP_ENABLED must be true or false.")
  if (env.HOMEOS_BACKUP_HOUR_UTC !== undefined && (!/^\d{1,2}$/.test(env.HOMEOS_BACKUP_HOUR_UTC) || Number(env.HOMEOS_BACKUP_HOUR_UTC) > 23)) throw new Error("HOMEOS_BACKUP_HOUR_UTC must be an hour from 0 to 23.")
  if (env.HOMEOS_BACKUP_RETENTION !== undefined && (!/^\d+$/.test(env.HOMEOS_BACKUP_RETENTION) || Number(env.HOMEOS_BACKUP_RETENTION) < 1 || Number(env.HOMEOS_BACKUP_RETENTION) > 30)) throw new Error("HOMEOS_BACKUP_RETENTION must be a number from 1 to 30.")
  if (env.HOMEOS_BACKUP_QUOTA_BYTES !== undefined && (!/^\d+$/.test(env.HOMEOS_BACKUP_QUOTA_BYTES) || Number(env.HOMEOS_BACKUP_QUOTA_BYTES) < 1024 * 1024 || !Number.isSafeInteger(Number(env.HOMEOS_BACKUP_QUOTA_BYTES)))) throw new Error("HOMEOS_BACKUP_QUOTA_BYTES must be at least 1 MiB.")
  if (env.HOMEOS_STORAGE_QUOTA_BYTES !== undefined && (!/^\d+$/.test(env.HOMEOS_STORAGE_QUOTA_BYTES) || Number(env.HOMEOS_STORAGE_QUOTA_BYTES) < 1 || !Number.isSafeInteger(Number(env.HOMEOS_STORAGE_QUOTA_BYTES)))) throw new Error("HOMEOS_STORAGE_QUOTA_BYTES must be a positive safe integer.")
  if (!env.HOMEOS_DATA_ROOT || !path.isAbsolute(env.HOMEOS_DATA_ROOT)) throw new Error("Set HOMEOS_DATA_ROOT to a separate absolute path on a mounted writable data volume.")

  const dataRoot = path.resolve(env.HOMEOS_DATA_ROOT)
  const storageRoot = path.resolve("/mnt/storage")
  if (inside(storageRoot, dataRoot) || inside(dataRoot, storageRoot)) throw new Error("HOMEOS_DATA_ROOT must be separate from /mnt/storage.")
  const rootInfo = await lstat(dataRoot).catch(() => null)
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("HOMEOS_DATA_ROOT must exist as a real mounted directory; create and mount it before starting HomeOS.")
  const canonicalDataRoot = await realpath(dataRoot)
  const canonicalStorageRoot = await realpath(storageRoot).catch(() => null)
  if (canonicalStorageRoot && (inside(canonicalStorageRoot, canonicalDataRoot) || inside(canonicalDataRoot, canonicalStorageRoot))) {
    throw new Error("HOMEOS_DATA_ROOT must resolve separately from /mnt/storage.")
  }
  await access(dataRoot, constants.R_OK | constants.W_OK | constants.X_OK).catch(() => {
    throw new Error("The unprivileged HomeOS account needs read, write, and traverse access to HOMEOS_DATA_ROOT.")
  })

  const dbPath = path.resolve(cwd, env.HOMEOS_DB_PATH || path.join(".homeos", "homeos.sqlite"))
  if (inside(storageRoot, dbPath) || inside(dataRoot, dbPath)) throw new Error("HOMEOS_DB_PATH must be outside both user storage volumes.")
}
