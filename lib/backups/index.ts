import "server-only"

import { copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, statfs, writeFile } from "node:fs/promises"
import { createReadStream } from "node:fs"
import path from "node:path"
import { createHash, randomUUID } from "node:crypto"
import Database from "better-sqlite3"
import { getNativeDatabase } from "@/lib/db"
import { isInsideStorageRoot, StoragePathError } from "@/lib/storage/path-policy"
import { listManagedUploads, resolveManagedDirectory, resolveManagedUpload } from "@/lib/storage/managed"

type BackupFile = { path: string; size: number; sha256: string }
type BackupManifest = { version: 1; createdAt: string; verifiedAt: string; integrity: "ok"; uploadCount: number; totalUploadBytes: number; files: BackupFile[] }

async function hashFile(filePath: string) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer)
  return hash.digest("hex")
}

function retentionLimit() {
  const raw = process.env.HOMEOS_BACKUP_RETENTION
  const count = raw ? Number(raw) : 7
  if (!Number.isSafeInteger(count) || count < 1 || count > 30) throw new StoragePathError("HOMEOS_BACKUP_RETENTION must be an integer from 1 to 30.", 503)
  return count
}

function backupQuotaBytes() {
  const raw = process.env.HOMEOS_BACKUP_QUOTA_BYTES
  const bytes = raw ? Number(raw) : 50 * 1024 * 1024 * 1024
  if (!Number.isSafeInteger(bytes) || bytes < 1024 * 1024) throw new StoragePathError("HOMEOS_BACKUP_QUOTA_BYTES must be at least 1 MiB.", 503)
  return bytes
}

function backupName(date: Date) {
  const stamp = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
  return `backup-${stamp}-${randomUUID().slice(0, 8)}`
}

async function listBackupDirectory(directory: string, root: string) {
  const items = await readdir(directory, { withFileTypes: true })
  const backups = await Promise.all(items.filter((item) => item.isDirectory() && /^backup-\d{8}T\d{6}Z-[a-f0-9]{8}$/.test(item.name)).map(async (item) => {
    try {
    const target = path.join(directory, item.name)
    const info = await lstat(target)
    if (!info.isDirectory() || info.isSymbolicLink()) return null
    const resolved = await realpath(target)
    if (!isInsideStorageRoot(root, resolved)) return null
    let manifest: Partial<BackupManifest>
    try { manifest = JSON.parse(await readFile(path.join(resolved, "manifest.json"), "utf8")) }
    catch { return null }
    if (manifest.integrity !== "ok" || typeof manifest.createdAt !== "string" || typeof manifest.verifiedAt !== "string") return null
    const databaseStat = await stat(path.join(resolved, "homeos.sqlite"))
    return { name: item.name, createdAt: manifest.createdAt, verifiedAt: manifest.verifiedAt, uploadCount: manifest.uploadCount ?? 0, totalUploadBytes: manifest.totalUploadBytes ?? 0, backupBytes: databaseStat.size + (manifest.totalUploadBytes ?? 0), integrity: manifest.integrity }
    } catch { return null }
  }))
  return backups.filter((item): item is NonNullable<typeof item> => item !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function listBackups() {
  const { root, path: directory } = await resolveManagedDirectory("backups", true)
  return listBackupDirectory(directory, root)
}

async function createBackupInternal() {
  const [{ root, path: backupRoot }, items] = await Promise.all([
    resolveManagedDirectory("backups", true),
    listManagedUploads(),
  ])
  const createdAt = new Date()
  const finalName = backupName(createdAt)
  const stagingName = `.building-${randomUUID()}`
  const stagingPath = path.join(backupRoot, stagingName)
  const destination = path.join(backupRoot, finalName)
  if (!isInsideStorageRoot(root, stagingPath) || !isInsideStorageRoot(root, destination)) throw new StoragePathError("Backup path is outside managed storage.", 403)
  const retention = retentionLimit()
  const quota = backupQuotaBytes()
  const database = getNativeDatabase()
  const estimatedBytes = Number(database.pragma("page_count", { simple: true })) * Number(database.pragma("page_size", { simple: true })) + items.reduce((sum, item) => sum + item.size, 0)
  if (estimatedBytes > quota) throw new StoragePathError("This backup would exceed HOMEOS_BACKUP_QUOTA_BYTES.", 413)
  const filesystem = await statfs(backupRoot)
  if ((filesystem.bavail * filesystem.bsize) < estimatedBytes + 64 * 1024 * 1024) throw new StoragePathError("There is not enough free space to safely create a backup.", 507)

  await mkdir(stagingPath, { mode: 0o700 })
  let snapshotBytes = 0
  let published = false
  try {
    const sqliteBackup = path.join(stagingPath, "homeos.sqlite")
    await getNativeDatabase().backup(sqliteBackup)
    const verified = new Database(sqliteBackup, { readonly: true, fileMustExist: true })
    let integrity: string
    try { integrity = verified.pragma("integrity_check", { simple: true }) as string }
    finally { verified.close() }
    if (integrity !== "ok") throw new Error("SQLite backup integrity verification failed.")

    const uploadFolder = path.join(stagingPath, "uploads")
    await mkdir(uploadFolder, { mode: 0o700 })
    for (const item of items) {
      const source = await resolveManagedUpload(item.name)
      await copyFile(source.path, path.join(uploadFolder, item.name))
    }
    snapshotBytes = (await stat(sqliteBackup)).size + items.reduce((sum, item) => sum + item.size, 0)
    if (snapshotBytes > quota) throw new StoragePathError("This backup exceeds HOMEOS_BACKUP_QUOTA_BYTES.", 413)
    const files: BackupFile[] = [{ path: "homeos.sqlite", size: (await stat(sqliteBackup)).size, sha256: await hashFile(sqliteBackup) }]
    for (const item of items) files.push({ path: `uploads/${item.name}`, size: item.size, sha256: await hashFile(path.join(uploadFolder, item.name)) })
    const manifest: BackupManifest = { version: 1, createdAt: createdAt.toISOString(), verifiedAt: createdAt.toISOString(), integrity, uploadCount: items.length, totalUploadBytes: items.reduce((sum, item) => sum + item.size, 0), files }
    await writeFile(path.join(stagingPath, "manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx", mode: 0o600 })
    await rename(stagingPath, destination)
    published = true
    const verification = await verifyBackup(finalName)
    if (!verification.ok) throw new Error("Backup restore verification failed.")
    manifest.verifiedAt = verification.verifiedAt
    await writeFile(path.join(destination, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 })
  } catch (error) {
    await rm(stagingPath, { recursive: true, force: true }).catch(() => undefined)
    if (published) await rm(destination, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }

  const existing = await listBackupDirectory(backupRoot, root)
  let remainingCount = existing.length
  let remainingBytes = existing.reduce((sum, backup) => sum + backup.backupBytes, 0)
  for (const old of [...existing].reverse()) {
    if (remainingCount <= retention && remainingBytes <= quota) break
    if (old.name === finalName) continue
    const target = path.join(backupRoot, old.name)
    const info = await lstat(target).catch(() => null)
    if (!info?.isDirectory() || info.isSymbolicLink()) continue
    const resolved = await realpath(target)
    if (isInsideStorageRoot(root, resolved) && resolved !== backupRoot) {
      await rm(resolved, { recursive: true, force: true })
      remainingCount -= 1
      remainingBytes -= old.backupBytes
    }
  }
  const completed = await listBackupDirectory(backupRoot, root)
  const item = completed.find((backup) => backup.name === finalName)
  if (!item) throw new Error("The verified snapshot could not be indexed.")
  return { ...item }
}

let backupQueue: Promise<void> = Promise.resolve()

export async function createBackup() {
  let release!: () => void
  const previous = backupQueue
  backupQueue = new Promise<void>((resolve) => { release = resolve })
  await previous
  try { return await createBackupInternal() }
  finally { release() }
}

export async function verifyBackup(name: string) {
  if (!/^backup-\d{8}T\d{6}Z-[a-f0-9]{8}$/.test(name)) throw new StoragePathError("That backup name is invalid.", 400)
  const { root, path: backupRoot } = await resolveManagedDirectory("backups")
  const target = path.join(backupRoot, name)
  const targetInfo = await lstat(target).catch(() => null)
  if (!targetInfo?.isDirectory() || targetInfo.isSymbolicLink()) throw new StoragePathError("Backup not found.", 404)
  const backupPath = await realpath(target)
  if (!isInsideStorageRoot(root, backupPath) || backupPath === backupRoot) throw new StoragePathError("That backup path is not allowed.", 403)
  let manifest: BackupManifest
  try { manifest = JSON.parse(await readFile(path.join(backupPath, "manifest.json"), "utf8")) as BackupManifest }
  catch { throw new StoragePathError("Backup manifest is missing or invalid.", 422) }
  if (manifest.version !== 1 || !Array.isArray(manifest.files) || manifest.files.length > 100_001 || !Number.isSafeInteger(manifest.uploadCount) || !Number.isSafeInteger(manifest.totalUploadBytes)) throw new StoragePathError("Backup manifest is invalid.", 422)
  let databaseSeen = false
  const seenFiles = new Set<string>()
  let uploadBytes = 0
  for (const record of manifest.files) {
    if (!record || typeof record.path !== "string" || typeof record.sha256 !== "string") throw new StoragePathError("Backup manifest contains an invalid file entry.", 422)
    const uploadName = record.path.startsWith("uploads/") ? record.path.slice("uploads/".length) : ""
    const validPath = record.path === "homeos.sqlite" || (uploadName && uploadName === path.basename(uploadName) && !uploadName.startsWith("."))
    if (!validPath || seenFiles.has(record.path) || !Number.isSafeInteger(record.size) || record.size < 0 || !/^[a-f\d]{64}$/.test(record.sha256)) throw new StoragePathError("Backup manifest contains an unsafe file entry.", 422)
    seenFiles.add(record.path)
    if (record.path === "homeos.sqlite") databaseSeen = true
    else uploadBytes += record.size
    const candidate = path.join(backupPath, record.path)
    const fileInfo = await lstat(candidate).catch(() => null)
    if (!fileInfo?.isFile() || fileInfo.isSymbolicLink() || fileInfo.size !== record.size) throw new StoragePathError("A backup file is missing or has changed.", 422)
    const canonicalFile = await realpath(candidate)
    if (!isInsideStorageRoot(backupPath, canonicalFile) || await hashFile(canonicalFile) !== record.sha256) throw new StoragePathError("A backup file failed its checksum.", 422)
  }
  if (!databaseSeen || manifest.integrity !== "ok" || seenFiles.size !== manifest.uploadCount + 1 || uploadBytes !== manifest.totalUploadBytes) throw new StoragePathError("The backup is incomplete.", 422)
  const sqlitePath = path.join(backupPath, "homeos.sqlite")
  const verificationDb = new Database(sqlitePath, { readonly: true, fileMustExist: true })
  let integrity: string
  try { integrity = verificationDb.pragma("integrity_check", { simple: true }) as string }
  finally { verificationDb.close() }
  if (integrity !== "ok") throw new StoragePathError("The snapshot database failed its integrity check.", 422)
  return { name, ok: true as const, integrity, fileCount: manifest.files.length, verifiedAt: new Date().toISOString() }
}
