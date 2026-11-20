import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import {
  isInsideStorageRoot,
  normalizeStoragePath,
  resolveSafeDirectory,
  StoragePathError,
} from "../lib/storage/path-policy.ts"

test("storage paths are relative and reject traversal and absolute paths", () => {
  assert.deepEqual(normalizeStoragePath(""), [])
  assert.deepEqual(normalizeStoragePath("Movies/2026"), ["Movies", "2026"])
  for (const unsafe of ["../outside", "Movies/../../etc", "/etc/passwd", "C:\\private", "a\\b", "folder/."]) {
    assert.throws(() => normalizeStoragePath(unsafe), StoragePathError, unsafe)
  }
})

test("storage boundary checks do not accept sibling paths", () => {
  assert.equal(isInsideStorageRoot("/mnt/storage", "/mnt/storage/Movies"), true)
  assert.equal(isInsideStorageRoot("/mnt/storage", "/mnt/storage-old/Movies"), false)
  assert.equal(isInsideStorageRoot("/mnt/storage", "/etc/passwd"), false)
})

test("safe resolver accepts directories and rejects symlink escapes", async (context) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "homeos-storage-test-"))
  const root = path.join(temporary, "storage")
  const outside = path.join(temporary, "outside")
  await mkdir(path.join(root, "Documents"), { recursive: true })
  await mkdir(outside)
  try {
    const result = await resolveSafeDirectory(root, ["Documents"])
    assert.equal(result.resolved, path.join(root, "Documents"))
    try {
      await symlink(outside, path.join(root, "external"), process.platform === "win32" ? "junction" : "dir")
    } catch (error) {
      if (process.platform === "win32") {
        context.skip(`Windows symlink creation is unavailable: ${error.message}`)
        return
      }
      throw error
    }
    await assert.rejects(resolveSafeDirectory(root, ["external"]), /Symbolic links/)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
