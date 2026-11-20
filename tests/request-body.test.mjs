import assert from "node:assert/strict"
import { test } from "node:test"
import { readBoundedText, RequestBodyTooLargeError } from "../lib/server/request-body.ts"

test("bounded request reader reads a small UTF-8 payload", async () => {
  const request = new Request("http://homeos.test", { method: "POST", body: "hello" })
  assert.equal(await readBoundedText(request, 5), "hello")
})

test("bounded request reader rejects an oversized declared length", async () => {
  const request = new Request("http://homeos.test", { method: "POST", headers: { "content-length": "100" }, body: "x" })
  await assert.rejects(readBoundedText(request, 5), RequestBodyTooLargeError)
})

test("bounded request reader cancels a streamed body after crossing its limit", async () => {
  let cancelled = false
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("1234"))
      controller.enqueue(new TextEncoder().encode("5678"))
    },
    cancel() { cancelled = true },
  })
  const request = new Request("http://homeos.test", { method: "POST", body, duplex: "half" })
  await assert.rejects(readBoundedText(request, 5), RequestBodyTooLargeError)
  assert.equal(cancelled, true)
})
