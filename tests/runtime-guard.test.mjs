import assert from "node:assert/strict"
import test from "node:test"
import { assertNonRoot } from "../lib/server/runtime.ts"

test("runtime guard allows unprivileged users and rejects UID zero", () => {
  assert.doesNotThrow(() => assertNonRoot(1000))
  assert.doesNotThrow(() => assertNonRoot(undefined))
  assert.throws(() => assertNonRoot(0), /must run as a non-root user/)
})
