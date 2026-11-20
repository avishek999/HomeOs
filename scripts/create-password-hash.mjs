import { randomBytes, scryptSync } from "node:crypto"
import { stdin, stdout } from "node:process"

async function readHidden(label) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error("Run this command in an interactive terminal so the password can be hidden.")
  }
  stdout.write(label)
  stdin.setRawMode(true)
  stdin.resume()
  return await new Promise((resolve, reject) => {
    let input = ""
    const restore = () => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.removeListener("data", onData)
      stdout.write("\n")
    }
    const onData = (buffer) => {
      for (const byte of buffer) {
        if (byte === 3) {
          restore()
          reject(new Error("Cancelled."))
          return
        }
        if (byte === 10 || byte === 13) {
          restore()
          resolve(input)
          return
        }
        if (byte === 8 || byte === 127) {
          input = input.slice(0, -1)
          continue
        }
        if (byte >= 32 && byte <= 126) input += String.fromCharCode(byte)
      }
    }
    stdin.on("data", onData)
  })
}

try {
  const password = await readHidden("HomeOS password (input hidden): ")
  if (password.length < 14) {
    throw new Error("Use a password with at least 14 characters.")
  }
  const salt = randomBytes(32).toString("hex")
  const hash = scryptSync(password, salt, 64).toString("hex")
  stdout.write(`\nHOMEOS_PASSWORD_HASH=${salt}:${hash}\n`)
} finally {
  stdin.pause()
}
