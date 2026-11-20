import "server-only"

import { lstat, readdir, realpath } from "node:fs/promises"
import path from "node:path"
import { isMockSystem } from "@/lib/system/metrics"
import { isInsideStorageRoot, normalizeStoragePath, resolveSafeDirectory, StoragePathError } from "./path-policy"
export { StoragePathError } from "./path-policy"

export type StorageEntry = {
  name: string
  path: string
  type: "directory" | "file"
  size: number
  modifiedAt: string
}

const STORAGE_ROOT = "/mnt/storage"
const MOCK_ENTRIES: StorageEntry[] = [
  { name: "Documents", path: "Documents", type: "directory", size: 0, modifiedAt: "2026-11-20T08:30:00.000Z" },
  { name: "Media", path: "Media", type: "directory", size: 0, modifiedAt: "2026-11-19T16:12:00.000Z" },
  { name: "Backups", path: "Backups", type: "directory", size: 0, modifiedAt: "2026-11-17T11:05:00.000Z" },
  { name: "readme.txt", path: "readme.txt", type: "file", size: 2048, modifiedAt: "2026-11-18T07:20:00.000Z" },
]

export async function listStorage(relativePath: string): Promise<{ path: string; entries: StorageEntry[]; source: "live" | "mock" }> {
  const segments = normalizeStoragePath(relativePath)
  const normalized = segments.join("/")

  if (isMockSystem()) {
    if (!normalized) return { path: "", entries: MOCK_ENTRIES, source: "mock" }
    const parent = normalized.split("/").slice(0, -1).join("/")
    const folder = normalized.split("/").at(-1)
    const known = MOCK_ENTRIES.find((entry) => entry.path === normalized && entry.type === "directory")
    if (!known) throw new StoragePathError("Folder not found.", 404)
    if (folder === "Documents") {
      return { path: normalized, entries: [{ name: "notes.txt", path: `${normalized}/notes.txt`, type: "file", size: 1024, modifiedAt: "2026-11-19T12:15:00.000Z" }], source: "mock" }
    }
    if (folder === "Media") {
      return { path: normalized, entries: [{ name: "sample-video.mp4", path: `${normalized}/sample-video.mp4`, type: "file", size: 0, modifiedAt: "2026-11-18T18:00:00.000Z" }], source: "mock" }
    }
    if (folder === "Backups") return { path: normalized, entries: [], source: "mock" }
    if (parent) throw new StoragePathError("Folder not found.", 404)
    return { path: normalized, entries: [], source: "mock" }
  }

  const { resolved } = await resolveSafeDirectory(STORAGE_ROOT, segments)

  const children = await readdir(resolved, { withFileTypes: true })
  const entries = await Promise.all(
    children
      .filter((child) => child.name !== "." && child.name !== ".." && !child.isSymbolicLink())
      .map(async (child) => {
        const childPath = path.join(resolved, child.name)
        const info = await lstat(childPath)
        const childRelative = [...segments, child.name].join("/")
        return {
          name: child.name,
          path: childRelative,
          type: child.isDirectory() ? "directory" as const : "file" as const,
          size: child.isFile() ? info.size : 0,
          modifiedAt: info.mtime.toISOString(),
        }
      }),
  )
  entries.sort((a, b) => Number(b.type === "directory") - Number(a.type === "directory") || a.name.localeCompare(b.name))
  return { path: normalized, entries, source: "live" }
}

/** Resolve one regular file beneath the existing read-only storage root. */
export async function resolveStorageFile(relativePath: string) {
  const segments = normalizeStoragePath(relativePath)
  if (segments.length === 0) throw new StoragePathError("Choose a file first.")
  if (isMockSystem()) throw new StoragePathError("File previews are unavailable in mock mode.", 404)
  const name = segments.at(-1)!
  const parent = await resolveSafeDirectory(STORAGE_ROOT, segments.slice(0, -1))
  const candidate = path.join(parent.resolved, name)
  const info = await lstat(candidate).catch(() => {
    throw new StoragePathError("File not found.", 404)
  })
  if (info.isSymbolicLink()) throw new StoragePathError("Symbolic links cannot be served.", 403)
  if (!info.isFile()) throw new StoragePathError("That item is not a file.", 400)
  const resolved = await realpath(candidate)
  if (!isInsideStorageRoot(parent.root, resolved)) throw new StoragePathError("That path is not allowed.", 403)
  return { path: resolved, size: info.size, modifiedAt: info.mtime }
}
