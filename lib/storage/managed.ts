import "server-only"

import { lstat, mkdir, open, readdir, realpath, stat } from "node:fs/promises"
import path from "node:path"
import { StoragePathError, isInsideStorageRoot } from "./path-policy"

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
const STORAGE_ROOT = path.resolve("/mnt/storage")
const DEFAULT_QUOTA_BYTES = 10 * 1024 * 1024 * 1024
let uploadQueue: Promise<void> = Promise.resolve()

function configuredRoot() {
  const configured = process.env.HOMEOS_DATA_ROOT
  if (!configured || !path.isAbsolute(configured)) {
    throw new StoragePathError("Set HOMEOS_DATA_ROOT to a dedicated, mounted data volume.", 503)
  }
  const root = path.resolve(configured)
  if (isInsideStorageRoot(STORAGE_ROOT, root) || isInsideStorageRoot(root, STORAGE_ROOT)) {
    throw new StoragePathError("The managed data volume must be separate from /mnt/storage.", 503)
  }
  return root
}

export async function resolveManagedDirectory(directoryName: string, create = false) {
  if (!/^(uploads|backups|deployments|photos|databases)$/.test(directoryName)) throw new StoragePathError("That managed directory is not allowed.", 400)
  const rootSetting = configuredRoot()
  const rootInfo = await lstat(rootSetting).catch(() => null)
  if (!rootInfo?.isDirectory() || rootInfo.isSymbolicLink()) throw new StoragePathError("The dedicated HomeOS data volume is not mounted as a real directory.", 503)
  const root = await realpath(rootSetting)
  const canonicalStorageRoot = await realpath(STORAGE_ROOT).catch(() => null)
  if (canonicalStorageRoot && (isInsideStorageRoot(canonicalStorageRoot, root) || isInsideStorageRoot(root, canonicalStorageRoot))) {
    throw new StoragePathError("The managed data volume must resolve separately from /mnt/storage.", 503)
  }
  const candidate = path.join(root, directoryName)
  if (create) await mkdir(candidate, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error
  })
  const dirInfo = await lstat(candidate).catch(() => null)
  if (!dirInfo || !dirInfo.isDirectory() || dirInfo.isSymbolicLink()) {
    if (!create && !dirInfo) throw new StoragePathError("Managed directory not found.", 404)
    throw new StoragePathError("The managed directory is not safe.", 503)
  }
  const resolved = await realpath(candidate)
  if (!isInsideStorageRoot(root, resolved)) throw new StoragePathError("The managed directory escaped the managed volume.", 403)
  return { root, path: resolved }
}

async function uploadDirectory() { return resolveManagedDirectory("uploads", true) }

export async function listManagedUploads() {
  const { path: uploadDir } = await uploadDirectory()
  const children = await readdir(uploadDir, { withFileTypes: true })
  const items = await Promise.all(children.filter((item) => item.isFile()).map(async (item) => {
    const info = await lstat(path.join(uploadDir, item.name))
    if (!info.isFile() || info.isSymbolicLink()) return null
    return { name: item.name, size: info.size, modifiedAt: info.mtime.toISOString() }
  }))
  return items.filter((item): item is NonNullable<typeof item> => item !== null).sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
}

export async function resolveManagedUpload(name: string) {
  if (!name || name !== path.basename(name) || name.startsWith(".") || /[\\/\0\r\n]/.test(name)) throw new StoragePathError("That filename is not allowed.", 400)
  const { root, path: uploadDir } = await uploadDirectory()
  const candidate = path.join(uploadDir, name)
  const info = await lstat(candidate).catch(() => null)
  if (!info || info.isSymbolicLink() || !info.isFile()) throw new StoragePathError("File not found.", 404)
  const resolved = await realpath(candidate)
  if (!isInsideStorageRoot(root, resolved)) throw new StoragePathError("That path is not allowed.", 403)
  const finalInfo = await stat(resolved)
  return { path: resolved, size: finalInfo.size }
}

async function storeUpload(file: File) {
  if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
    throw new StoragePathError("Files must be between 1 byte and 25 MB.", 413)
  }
  const { root, path: uploadDir } = await uploadDirectory()
  const configuredQuota = process.env.HOMEOS_STORAGE_QUOTA_BYTES ? Number(process.env.HOMEOS_STORAGE_QUOTA_BYTES) : DEFAULT_QUOTA_BYTES
  if (!Number.isSafeInteger(configuredQuota) || configuredQuota <= 0) throw new StoragePathError("HOMEOS_STORAGE_QUOTA_BYTES must be a positive safe integer.", 503)
  const current = await listManagedUploads()
  if (current.reduce((sum, item) => sum + item.size, 0) + file.size > configuredQuota) throw new StoragePathError("The managed storage quota would be exceeded.", 413)

  const rawName = file.name.normalize("NFC")
  if (!rawName || rawName === "." || rawName === ".." || /[\\/\0\r\n]/.test(rawName) || rawName.startsWith(".")) {
    throw new StoragePathError("That filename is not allowed.", 400)
  }
  const name = rawName.trim().replace(/\s+/g, " ")
  if (!name || Buffer.byteLength(name, "utf8") > 200) throw new StoragePathError("That filename is too long.", 400)
  const target = path.join(uploadDir, name)
  if (!isInsideStorageRoot(root, target)) throw new StoragePathError("That path is not allowed.", 403)

  const handle = await open(target, "wx", 0o600).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST") throw new StoragePathError("A file with that name already exists.", 409)
    throw error
  })
  try {
    const bytes = Buffer.from(await file.arrayBuffer())
    if (bytes.byteLength !== file.size) throw new Error("Upload size changed while being read.")
    await handle.writeFile(bytes)
    await handle.sync()
  } catch (error) {
    await handle.close()
    const { unlink } = await import("node:fs/promises")
    await unlink(target).catch(() => undefined)
    throw error
  }
  await handle.close()
  return { name, size: file.size, path: `uploads/${name}` }
}

export async function storeManagedUpload(file: File) {
  let release!: () => void
  const previous = uploadQueue
  uploadQueue = new Promise<void>((resolve) => { release = resolve })
  await previous
  try { return await storeUpload(file) }
  finally { release() }
}

export const maxManagedUploadBytes = MAX_UPLOAD_BYTES
