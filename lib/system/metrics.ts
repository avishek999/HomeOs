import "server-only"

import si from "systeminformation"
import { createMockMetrics } from "./mock"

export type SystemMetrics = {
  hostname: string
  platform: string
  uptimeSeconds: number
  cpuPercent: number
  cpuCores: number
  memoryTotal: number
  memoryUsed: number
  storageTotal: number
  storageUsed: number
  sampledAt: string
  source: "live" | "mock"
}

export function isMockSystem() {
  return (
    process.env.HOMEOS_MOCK_SYSTEM === "true" ||
    (process.platform === "darwin" && process.env.NODE_ENV !== "production")
  )
}

export async function getSystemMetrics(): Promise<SystemMetrics> {
  if (isMockSystem()) return createMockMetrics()

  const [load, memory, filesystems, os] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.fsSize(),
    si.osInfo(),
  ])
  const rootFs = filesystems.find((item) => item.mount === "/") ?? filesystems[0]
  return {
    hostname: os.hostname || "Unknown host",
    platform: `${os.distro || os.platform} ${os.release}`,
    uptimeSeconds: Math.floor(si.time().uptime),
    cpuPercent: Math.round(load.currentLoad * 10) / 10,
    cpuCores: load.cpus.length || (await si.cpu()).cores,
    memoryTotal: memory.total,
    memoryUsed: memory.used,
    storageTotal: rootFs?.size ?? 0,
    storageUsed: rootFs?.used ?? 0,
    sampledAt: new Date().toISOString(),
    source: "live",
  }
}
