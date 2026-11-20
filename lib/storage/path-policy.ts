import path from "node:path"
import { lstat, realpath, stat } from "node:fs/promises"

export class StoragePathError extends Error {
  readonly status: number

  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

export function normalizeStoragePath(input: string) {
  if (input.includes("\0") || input.includes("\\") || path.posix.isAbsolute(input)) {
    throw new StoragePathError("That path is not allowed.")
  }
  const segments = input.split("/").filter(Boolean)
  if (segments.some((part) => part === "." || part === "..")) {
    throw new StoragePathError("That path is not allowed.")
  }
  return segments
}

export function isInsideStorageRoot(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}

export async function resolveSafeDirectory(storageRoot: string, segments: string[]) {
  const rootInfo = await lstat(storageRoot).catch(() => {
    throw new StoragePathError("The storage root is not available.", 503)
  })
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new StoragePathError("The storage root must be a real directory.", 403)
  }
  const root = await realpath(storageRoot).catch(() => {
    throw new StoragePathError("The storage root is not available.", 503)
  })

  let current = root
  for (const segment of segments) {
    current = path.join(current, segment)
    const item = await lstat(current).catch(() => {
      throw new StoragePathError("Folder not found.", 404)
    })
    if (item.isSymbolicLink()) throw new StoragePathError("Symbolic links cannot be browsed.", 403)
  }

  const resolved = await realpath(current).catch(() => {
    throw new StoragePathError("Folder not found.", 404)
  })
  if (!isInsideStorageRoot(root, resolved)) throw new StoragePathError("That path is not allowed.", 403)
  const folderStat = await stat(resolved)
  if (!folderStat.isDirectory()) throw new StoragePathError("That path is not a folder.", 400)
  return { root, resolved }
}
