export type MockMetrics = {
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
  source: "mock"
}

export function createMockMetrics(now = Date.now()): MockMetrics {
  const wave = (Math.sin(now / 18_000) + 1) / 2
  return {
    hostname: "homeos-mac-dev",
    platform: "macOS development · mock metrics",
    uptimeSeconds: 5 * 24 * 60 * 60 + Math.floor((now / 1000) % 86400),
    cpuPercent: Math.round(18 + wave * 24),
    cpuCores: 8,
    memoryTotal: 16 * 1024 ** 3,
    memoryUsed: Math.round(16 * 1024 ** 3 * (0.47 + wave * 0.09)),
    storageTotal: 1 * 1024 ** 4,
    storageUsed: Math.round(1 * 1024 ** 4 * 0.62),
    sampledAt: new Date(now).toISOString(),
    source: "mock",
  }
}
