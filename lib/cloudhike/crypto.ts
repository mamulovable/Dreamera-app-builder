import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"

// Encrypts what CloudHike gives us for a person (their access token and their
// project's .env) before it's saved, so a database leak alone doesn't expose them.

const VERSION = "v1"

function key() {
  const secret = process.env.CLOUDHIKE_ENCRYPTION_KEY
  if (!secret) throw new Error("CLOUDHIKE_ENCRYPTION_KEY must be set to connect CloudHike accounts.")
  return createHash("sha256").update(secret).digest()
}

export function seal(plaintext: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key(), iv)
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".")
}

export function unseal(sealed: string) {
  const [version, iv, tag, data] = sealed.split(".")
  if (version !== VERSION) throw new Error("Unknown sealed value.")
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"))
  decipher.setAuthTag(Buffer.from(tag, "base64url"))
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8")
}
