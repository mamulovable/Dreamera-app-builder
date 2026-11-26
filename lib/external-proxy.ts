// Outbound calls for generated apps that need a stored API key. Validates the
// target URL (SSRF), injects the secret, and never returns the key to the client.

import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

const BLOCKED_HEADER = /^(authorization|proxy-authorization|cookie|x-api-key|api-key)$/i
const ALLOWED_AUTH_HEADERS = new Set(["authorization", "x-api-key", "api-key"])
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"])
const MAX_URL_LENGTH = 2_048
const MAX_BODY_BYTES = 128 * 1024
const MAX_RESPONSE_BYTES = 512 * 1024
const FETCH_TIMEOUT_MS = 20_000

export type ExternalAuth =
  | { type: "bearer" }
  | { type: "header"; name: string }
  | { type: "query"; name: string }

export type ExternalProxyInput = {
  secretName: string
  url: string
  method?: string
  headers?: Record<string, string>
  body?: unknown
  auth?: ExternalAuth
}

export class ExternalProxyError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message)
  }
}

function isPrivateIp(ip: string) {
  const version = isIP(ip)
  if (version === 4) {
    const parts = ip.split(".").map(Number)
    if (parts[0] === 10) return true
    if (parts[0] === 127) return true
    if (parts[0] === 0) return true
    if (parts[0] === 169 && parts[1] === 254) return true
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
    if (parts[0] === 192 && parts[1] === 168) return true
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true
    return false
  }
  if (version === 6) {
    const normalized = ip.toLowerCase()
    if (normalized === "::" || normalized === "::1") return true
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true
    if (normalized.startsWith("fe80")) return true
    if (normalized.startsWith("::ffff:")) return isPrivateIp(normalized.slice(7))
    return false
  }
  return true
}

export async function assertPublicHttpsUrl(raw: string) {
  if (typeof raw !== "string" || !raw.trim() || raw.length > MAX_URL_LENGTH) {
    throw new ExternalProxyError("Give a valid https URL.")
  }
  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch {
    throw new ExternalProxyError("Give a valid https URL.")
  }
  if (parsed.protocol !== "https:") throw new ExternalProxyError("Only https URLs are allowed.")
  if (parsed.username || parsed.password) throw new ExternalProxyError("URLs with credentials are not allowed.")
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase()
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new ExternalProxyError("That host isn't allowed.")
  }
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new ExternalProxyError("That host isn't allowed.")
  } else {
    let addresses: string[]
    try {
      addresses = (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address)
    } catch {
      throw new ExternalProxyError("Couldn't resolve that host.", 400)
    }
    if (addresses.length === 0 || addresses.some(isPrivateIp)) {
      throw new ExternalProxyError("That host isn't allowed.")
    }
  }
  return parsed
}

function cleanHeaders(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {}
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof key !== "string" || typeof value !== "string") continue
    if (!key.trim() || key.length > 64 || value.length > 1_024) continue
    if (BLOCKED_HEADER.test(key) || key.toLowerCase() === "host") continue
    headers[key] = value
  }
  return headers
}

function parseAuth(input: unknown): ExternalAuth {
  if (!input || typeof input !== "object") return { type: "bearer" }
  const auth = input as { type?: unknown; name?: unknown }
  if (auth.type === "query") {
    const name = typeof auth.name === "string" && /^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(auth.name) ? auth.name : "api_key"
    return { type: "query", name }
  }
  if (auth.type === "header") {
    const name = typeof auth.name === "string" ? auth.name.trim().toLowerCase() : "x-api-key"
    if (!ALLOWED_AUTH_HEADERS.has(name)) throw new ExternalProxyError("That auth header isn't allowed.")
    return { type: "header", name }
  }
  return { type: "bearer" }
}

export async function proxyExternalRequest(secretValue: string, input: {
  url: string
  method?: unknown
  headers?: unknown
  body?: unknown
  auth?: unknown
}) {
  const target = await assertPublicHttpsUrl(input.url)
  const method = typeof input.method === "string" ? input.method.toUpperCase() : "GET"
  if (!ALLOWED_METHODS.has(method)) throw new ExternalProxyError("That HTTP method isn't allowed.")

  const auth = parseAuth(input.auth)
  const headers = cleanHeaders(input.headers)
  headers.accept = headers.accept ?? "application/json"

  if (auth.type === "bearer") headers.authorization = `Bearer ${secretValue}`
  else if (auth.type === "header") headers[auth.name] = secretValue
  else target.searchParams.set(auth.name, secretValue)

  let body: string | undefined
  if (method !== "GET" && method !== "DELETE" && input.body !== undefined) {
    body = typeof input.body === "string" ? input.body : JSON.stringify(input.body)
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new ExternalProxyError("That request body is too large.", 413)
    if (!headers["content-type"] && typeof input.body !== "string") headers["content-type"] = "application/json"
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(target.toString(), {
      method,
      headers,
      body,
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ExternalProxyError("The external API took too long to answer.", 504)
    }
    throw new ExternalProxyError("Couldn't reach that API.", 502)
  } finally {
    clearTimeout(timer)
  }

  const raw = Buffer.from(await response.arrayBuffer())
  if (raw.byteLength > MAX_RESPONSE_BYTES) {
    throw new ExternalProxyError("The external API response was too large.", 502)
  }

  const contentType = response.headers.get("content-type") ?? ""
  let data: unknown = null
  const text = raw.toString("utf8")
  if (contentType.includes("application/json") || /^[\[{]/.test(text.trim())) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  } else {
    data = text
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
  }
}
