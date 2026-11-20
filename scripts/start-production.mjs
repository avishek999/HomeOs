import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import nextEnv from "@next/env"
import { validateProductionEnvironment } from "../lib/server/production-preflight.mjs"

nextEnv.loadEnvConfig(process.cwd())

try {
  await validateProductionEnvironment()
} catch (error) {
  console.error(`HomeOS production preflight failed: ${error instanceof Error ? error.message : "invalid configuration"}`)
  process.exitCode = 1
  process.exit()
}

const standaloneCandidates = [path.join(process.cwd(), "server.js"), path.join(process.cwd(), ".next", "standalone", "server.js")]
const standalone = standaloneCandidates.find(existsSync)
const nextCli = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url))
const command = standalone ? [standalone] : [nextCli, "start", ...process.argv.slice(2)]
const server = spawn(process.execPath, command, { stdio: "inherit", env: process.env, cwd: standalone ? path.dirname(standalone) : process.cwd() })
server.on("error", (error) => { console.error(`Unable to start Next.js: ${error.message}`); process.exitCode = 1 })
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal))
server.on("exit", (code, signal) => { process.exitCode = signal ? 1 : (code ?? 1) })
