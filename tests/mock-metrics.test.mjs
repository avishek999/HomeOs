import assert from "node:assert/strict"
import test from "node:test"
import { createMockMetrics } from "../lib/system/mock.ts"

test("mock metrics are labeled, bounded, and stable for a given time", () => {
  const first = createMockMetrics(1_800_000_000_000)
  const second = createMockMetrics(1_800_000_000_000)
  assert.deepEqual(first, second)
  assert.equal(first.source, "mock")
  assert.match(first.hostname, /homeos-mac-dev/)
  assert.ok(first.cpuPercent >= 18 && first.cpuPercent <= 42)
  assert.ok(first.memoryUsed > 0 && first.memoryUsed < first.memoryTotal)
  assert.ok(first.storageUsed > 0 && first.storageUsed < first.storageTotal)
})
