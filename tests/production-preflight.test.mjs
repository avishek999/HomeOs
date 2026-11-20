import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { validateProductionEnvironment } from "../lib/server/production-preflight.mjs"

const validEnvironment = (dataRoot) => ({
  HOMEOS_PASSWORD_HASH: `${"a".repeat(64)}:${"b".repeat(128)}`,
  HOMEOS_SESSION_SECRET: "c".repeat(64),
  HOMEOS_DATA_ROOT: dataRoot,
})

test("production preflight accepts valid secrets and a writable dedicated volume", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "homeos-preflight-"))
  try {
    const data = path.join(dir, "data")
    await mkdir(data)
    await validateProductionEnvironment(validEnvironment(data), undefined, dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("production preflight refuses root and weak authentication configuration", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "homeos-preflight-"))
  try {
    const data = path.join(dir, "data")
    await mkdir(data)
    const config = validEnvironment(data)
    await assert.rejects(validateProductionEnvironment(config, 0, dir), /never root/)
    await assert.rejects(validateProductionEnvironment({ ...config, HOMEOS_SESSION_SECRET: "short" }, undefined, dir), /32 characters/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("production preflight rejects a database stored on the managed volume", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "homeos-preflight-"))
  try {
    const data = path.join(dir, "data")
    await mkdir(data)
    await assert.rejects(validateProductionEnvironment({ ...validEnvironment(data), HOMEOS_DB_PATH: path.join(data, "homeos.sqlite") }, undefined, dir), /outside both/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
