import assert from "node:assert/strict"
import { randomBytes, scryptSync } from "node:crypto"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"

if (process.getuid?.() === 0) {
  throw new Error("Do not start the HomeOS smoke-test server as root.")
}

const tempDir = await mkdtemp(path.join(os.tmpdir(), "homeos-smoke-"))
const managedRoot = path.join(tempDir, "managed-data")
await mkdir(managedRoot)
const password = "temporary-homeos-test-password"
const salt = randomBytes(32).toString("hex")
const hash = scryptSync(password, salt, 64).toString("hex")
const sessionSecret = randomBytes(32).toString("hex")
const portServer = net.createServer()
await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve))
const address = portServer.address()
const port = typeof address === "object" && address ? address.port : 3317
await new Promise((resolve) => portServer.close(resolve))

const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: "production",
    HOMEOS_DB_PATH: path.join(tempDir, "homeos.sqlite"),
    HOMEOS_DATA_ROOT: managedRoot,
    HOMEOS_BACKUP_ENABLED: "false",
    HOMEOS_PASSWORD_HASH: `${salt}:${hash}`,
    HOMEOS_SESSION_SECRET: sessionSecret,
    HOMEOS_MOCK_SYSTEM: "true",
    HOMEOS_GITHUB_REPOSITORIES: "[]",
    HOMEOS_GITHUB_TOKEN: "",
  },
  stdio: "ignore",
})

const base = `http://127.0.0.1:${port}`
async function waitForServer(child, url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`HomeOS exited with code ${child.exitCode}`)
    try {
      await fetch(`${url}/api/auth/session`, { signal: AbortSignal.timeout(500) })
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  throw new Error("HomeOS did not start in time.")
}

async function reservePort() {
  const temporaryServer = net.createServer()
  await new Promise((resolve) => temporaryServer.listen(0, "127.0.0.1", resolve))
  const bound = temporaryServer.address()
  const reserved = typeof bound === "object" && bound ? bound.port : 3317
  await new Promise((resolve) => temporaryServer.close(resolve))
  return reserved
}

async function stopServer(child) {
  if (child.exitCode !== null) return
  await new Promise((resolve) => {
    child.once("exit", resolve)
    child.kill("SIGTERM")
  })
}

try {
  await waitForServer(server, base)
  const loginPage = await fetch(`${base}/login`)
  assert.equal(loginPage.status, 200, "sign-in page is public")
  assert.match(await loginPage.text(), /Welcome home/)
  assert.equal(loginPage.headers.get("x-frame-options"), "DENY", "pages deny framing")
  const dashboard = await fetch(`${base}/dashboard`, { redirect: "manual" })
  assert.equal(dashboard.status, 307, "private page redirects when signed out")
  assert.equal(dashboard.headers.get("location"), "/login")

  const privateMetrics = await fetch(`${base}/api/system`)
  assert.equal(privateMetrics.status, 401, "system API rejects signed-out requests")
  const privateFiles = await fetch(`${base}/api/files`)
  assert.equal(privateFiles.status, 401, "files API rejects signed-out requests")
  assert.equal((await fetch(`${base}/api/media?kind=photos`)).status, 401, "media API rejects signed-out requests")
  assert.equal((await fetch(`${base}/api/media/content?path=Media%2Fsample-video.mp4`)).status, 401, "media content API rejects signed-out requests")
  assert.equal((await fetch(`${base}/api/uploads`)).status, 401, "managed storage API rejects signed-out requests")
  assert.equal((await fetch(`${base}/api/database`)).status, 401, "database API rejects signed-out requests")
  assert.equal((await fetch(`${base}/api/backups`)).status, 401, "backup API rejects signed-out requests")
  assert.equal((await fetch(`${base}/api/docker`)).status, 401, "Docker management API rejects signed-out requests")
  assert.equal((await fetch(`${base}/api/deployments`)).status, 401, "deployment API rejects signed-out requests")

  const origin = { Origin: base, "Content-Type": "application/json" }
  const badOrigin = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) })
  assert.equal(badOrigin.status, 403, "login rejects requests without a verified origin")
  const wrongPassword = await fetch(`${base}/api/auth/login`, { method: "POST", headers: origin, body: JSON.stringify({ password: "incorrect test password" }) })
  assert.equal(wrongPassword.status, 401, "incorrect password is rejected")
  const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: origin, body: JSON.stringify({ password }) })
  assert.equal(login.status, 200, "correct single-user password starts a session")
  const cookie = login.headers.get("set-cookie")?.split(";")[0]
  assert.ok(cookie?.startsWith("homeos_session="), "session cookie is set")
  assert.match(login.headers.get("set-cookie") || "", /HttpOnly/i)
  assert.match(login.headers.get("set-cookie") || "", /SameSite=Strict/i)
  assert.match(login.headers.get("set-cookie") || "", /Secure/i)

  const privateDashboard = await fetch(`${base}/dashboard`, { headers: { Cookie: cookie } })
  assert.equal(privateDashboard.status, 200, "valid session opens the dashboard")
  assert.match(await privateDashboard.text(), /Overview/)
  const privateFilePage = await fetch(`${base}/files`, { headers: { Cookie: cookie } })
  assert.equal(privateFilePage.status, 200, "valid session opens the file browser")
  assert.match(await privateFilePage.text(), /read-only view/)
  const cloudPage = await fetch(`${base}/cloud`, { headers: { Cookie: cookie } })
  assert.equal(cloudPage.status, 200, "valid session opens private cloud storage")
  assert.match(await cloudPage.text(), /Cloud storage/)
  const databasePage = await fetch(`${base}/database`, { headers: { Cookie: cookie } })
  assert.equal(databasePage.status, 200, "valid session opens database management")
  const dockerPage = await fetch(`${base}/docker`, { headers: { Cookie: cookie } })
  assert.equal(dockerPage.status, 200, "valid session opens Docker management")
  assert.equal((await fetch(`${base}/deployments`, { headers: { Cookie: cookie } })).status, 200, "valid session opens deployment console")
  const deploymentList = await fetch(`${base}/api/deployments`, { headers: { Cookie: cookie } })
  assert.equal(deploymentList.status, 200, "deployment inventory is available to the signed-in user")
  assert.deepEqual((await deploymentList.json()).apps, [], "deployment inventory follows the explicit empty allow-list")
  const deniedDeployment = await fetch(`${base}/api/deployments`, { method: "POST", headers: { Cookie: cookie, Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ repo: "unlisted/repository" }) })
  assert.equal(deniedDeployment.status, 403, "deployment API rejects repositories outside its allow-list")

  const session = await fetch(`${base}/api/auth/session`, { headers: { Cookie: cookie } })
  assert.equal(session.status, 200)
  const metricsResponse = await fetch(`${base}/api/system`, { headers: { Cookie: cookie } })
  assert.equal(metricsResponse.status, 200)
  const metrics = await metricsResponse.json()
  assert.equal(metrics.source, "mock")
  assert.equal(metrics.hostname, "homeos-mac-dev")
  assert.ok(metrics.cpuPercent >= 0 && metrics.cpuPercent <= 100)

  const filesResponse = await fetch(`${base}/api/files`, { headers: { Cookie: cookie } })
  assert.equal(filesResponse.status, 200)
  const listing = await filesResponse.json()
  assert.equal(listing.source, "mock")
  assert.ok(listing.entries.some((entry) => entry.type === "directory"))
  const traversal = await fetch(`${base}/api/files?path=${encodeURIComponent("../../etc")}`, { headers: { Cookie: cookie } })
  assert.equal(traversal.status, 400, "traversal is rejected after authentication")
  const writeAttempt = await fetch(`${base}/api/files`, { method: "POST", headers: { Cookie: cookie } })
  assert.equal(writeAttempt.status, 405, "file API is read only")

  const photoLibrary = await fetch(`${base}/api/media?kind=photos`, { headers: { Cookie: cookie } })
  assert.equal(photoLibrary.status, 200, "authenticated media listing is available")
  const mockMovie = await fetch(`${base}/api/media?kind=movies&path=Media`, { headers: { Cookie: cookie } })
  assert.equal(mockMovie.status, 200)
  assert.equal((await mockMovie.json()).entries[0].name, "sample-video.mp4")
  const uploadForm = new FormData()
  uploadForm.set("file", new Blob(["private upload test"]), "notes.txt")
  const uploadResponse = await fetch(`${base}/api/uploads`, { method: "POST", headers: { Cookie: cookie, Origin: base }, body: uploadForm })
  assert.equal(uploadResponse.status, 201, "authenticated upload stores data under managed root")
  const noOriginUpload = await fetch(`${base}/api/uploads`, { method: "POST", headers: { Cookie: cookie }, body: new FormData() })
  assert.equal(noOriginUpload.status, 403, "uploads reject requests without a verified origin")
  const uploadAgain = new FormData()
  uploadAgain.set("file", new Blob(["should not replace"]), "notes.txt")
  const conflict = await fetch(`${base}/api/uploads`, { method: "POST", headers: { Cookie: cookie, Origin: base }, body: uploadAgain })
  assert.equal(conflict.status, 409, "uploads never overwrite existing files")
  const uploadList = await fetch(`${base}/api/uploads`, { headers: { Cookie: cookie } })
  const uploadedItems = await uploadList.json()
  assert.equal(uploadedItems.items.length, 1)
  const download = await fetch(`${base}/api/uploads/content?name=notes.txt`, { headers: { Cookie: cookie } })
  assert.equal(await download.text(), "private upload test", "uploads can be downloaded through an authenticated API")
  const databaseStatus = await fetch(`${base}/api/database`, { headers: { Cookie: cookie } })
  assert.equal(databaseStatus.status, 200)
  const database = await databaseStatus.json()
  assert.equal(database.integrity, "ok")
  assert.ok(database.tables.includes("sessions"))
  const arbitrarySql = await fetch(`${base}/api/database`, { method: "POST", headers: { Cookie: cookie, Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ action: "DROP TABLE sessions" }) })
  assert.equal(arbitrarySql.status, 400, "database endpoint rejects arbitrary operations")
  const checkpoint = await fetch(`${base}/api/database`, { method: "POST", headers: { Cookie: cookie, Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ action: "checkpoint" }) })
  assert.equal(checkpoint.status, 200, "database offers a bounded WAL checkpoint operation")
  const backupResponse = await fetch(`${base}/api/backups`, { method: "POST", headers: { Cookie: cookie, Origin: base } })
  assert.equal(backupResponse.status, 201, "backup creates a private snapshot")
  const { backup } = await backupResponse.json()
  assert.equal(backup.integrity, "ok", "backup passes SQLite restore verification")
  const verifyResponse = await fetch(`${base}/api/backups`, { method: "POST", headers: { Cookie: cookie, Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ action: "verify", name: backup.name }) })
  assert.equal(verifyResponse.status, 200, "backup verification rechecks snapshot files")
  assert.equal((await verifyResponse.json()).verification.fileCount, 2, "verification checks the database and uploaded file")
  const backupHistory = await fetch(`${base}/api/backups`, { headers: { Cookie: cookie } })
  assert.equal((await backupHistory.json()).backups.length, 1)
  const invalidDockerAction = await fetch(`${base}/api/docker`, { method: "POST", headers: { Cookie: cookie, Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ id: "../../etc/passwd", action: "delete" }) })
  assert.equal(invalidDockerAction.status, 400, "Docker API rejects arbitrary identifiers and actions")

  const logout = await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { Cookie: cookie, Origin: base } })
  assert.equal(logout.status, 200)
  const expiredSession = await fetch(`${base}/api/auth/session`, { headers: { Cookie: cookie } })
  assert.equal(expiredSession.status, 401, "logout revokes the database session")

  const livePort = await reservePort()
  const liveBase = `http://127.0.0.1:${livePort}`
  const liveServer = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(livePort)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      HOMEOS_DB_PATH: path.join(tempDir, "live.sqlite"),
      HOMEOS_PASSWORD_HASH: `${salt}:${hash}`,
      HOMEOS_SESSION_SECRET: sessionSecret,
      HOMEOS_MOCK_SYSTEM: "false",
      HOMEOS_BACKUP_ENABLED: "false",
    },
    stdio: "ignore",
  })
  try {
    await waitForServer(liveServer, liveBase)
    const liveLogin = await fetch(`${liveBase}/api/auth/login`, { method: "POST", headers: { Origin: liveBase, "Content-Type": "application/json" }, body: JSON.stringify({ password }) })
    assert.equal(liveLogin.status, 200)
    const liveCookie = liveLogin.headers.get("set-cookie")?.split(";")[0]
    assert.ok(liveCookie)
    const liveMetricsResponse = await fetch(`${liveBase}/api/system`, { headers: { Cookie: liveCookie } })
    assert.equal(liveMetricsResponse.status, 200)
    const liveMetrics = await liveMetricsResponse.json()
    assert.equal(liveMetrics.source, "live")
    assert.ok(liveMetrics.hostname.length > 0)
    assert.ok(liveMetrics.cpuCores > 0)
    assert.ok(liveMetrics.memoryTotal > 0)
  } finally {
    await stopServer(liveServer)
  }

  console.log("Smoke checks passed: auth, security headers, private routes, media, managed uploads, database maintenance, verified backups, Docker boundaries, GitHub deployment allow-list, and storage traversal guards.")
} finally {
  await stopServer(server)
  await rm(tempDir, { recursive: true, force: true })
}
