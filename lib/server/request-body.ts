export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Request body is too large.")
    this.name = "RequestBodyTooLargeError"
  }
}

/** Read a small API payload without ever buffering more than its configured byte limit. */
export async function readBoundedText(request: Request, maxBytes: number) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0)
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new RequestBodyTooLargeError()

  const reader = request.body?.getReader()
  if (!reader) return ""
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel()
        throw new RequestBodyTooLargeError()
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, totalBytes).toString("utf8")
}
