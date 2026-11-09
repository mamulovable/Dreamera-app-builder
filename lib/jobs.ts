import { createHmac, timingSafeEqual } from "node:crypto"

// CloudHike Jobs (https://cloudhike.dev/docs/jobs): a worker calls a public URL
// of ours and waits for the answer. It only reports the final answer, so
// anything streamed while a run works has to reach the browser another way.

export type JobRun = {
  id: string
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled"
  error: string | null
}

function jobsRequest(path: string, init?: RequestInit) {
  if (!process.env.JOBS_API_URL || !process.env.JOBS_API_KEY) {
    throw new Error("JOBS_API_URL and JOBS_API_KEY must be set to build screens.")
  }
  return fetch(`${process.env.JOBS_API_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", "x-api-key": process.env.JOBS_API_KEY },
  })
}

function jobsPublicBase() {
  return process.env.JOBS_PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL || ""
}

/** Localhost is the dev machine. Jobs cannot call it, and a tunnel address is not the deployed site. */
export function isPublicAppUrl(base: string | null | undefined) {
  if (!base) return false
  try {
    return !/^(localhost|127\.0\.0\.1)$/i.test(new URL(base).hostname)
  } catch {
    return false
  }
}

/** The host the browser or Jobs worker actually called, so a deploy is not sent back to a local tunnel. */
export function originFromRequest(request: Request) {
  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()
  const host = forwarded || request.headers.get("host")?.split(",")[0]?.trim()
  if (!host) {
    try {
      return new URL(request.url).origin
    } catch {
      return null
    }
  }
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || (local ? "http" : "https")
  return `${proto}://${host}`
}

/**
 * Where a build step should be called. The request's own public host wins, so a
 * deployed app calls itself. `JOBS_PUBLIC_URL` is only the fallback for localhost.
 */
export function jobCallbackBase(origin?: string | null) {
  if (isPublicAppUrl(origin)) return origin as string
  const base = jobsPublicBase()
  return isPublicAppUrl(base) ? base : ""
}

/** Jobs can call this app only at a public address, with both credentials set. */
export function jobsCanReachApp() {
  if (!process.env.JOBS_API_URL || !process.env.JOBS_API_KEY) return false
  return isPublicAppUrl(jobsPublicBase())
}

/**
 * Whether Jobs can open `base` right now. An offline tunnel answers 404
 * (ngrok ERR_NGROK_3200). Used in development only: production must not refuse
 * to start just because this server cannot fetch its own homepage.
 */
export async function jobsEndpointUp(base = jobsPublicBase()) {
  if (!isPublicAppUrl(base)) return false
  try {
    const response = await fetch(new URL("/", base), {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: { "ngrok-skip-browser-warning": "1" },
    })
    if (!response.ok) return false
    const text = await response.text()
    return !text.includes("ERR_NGROK")
  } catch {
    return false
  }
}

/** Where Jobs reaches this app. It refuses localhost, so local development needs a tunnel. */
function publicUrl(path: string, base = jobsPublicBase()) {
  if (!isPublicAppUrl(base)) {
    throw new Error(`CloudHike Jobs can't reach "${base || "this app"}". Set JOBS_PUBLIC_URL to this app's public URL or a tunnel to it.`)
  }
  return new URL(path, base).toString()
}

/** Starts a run that POSTs `body` to `path` on this app. Results are read by polling, so no webhook is sent. */
export async function startJobRun({
  path,
  body,
  retries,
  base,
}: {
  path: string
  body: unknown
  retries: number
  base?: string
}) {
  const response = await jobsRequest("/runs", {
    method: "POST",
    body: JSON.stringify({
      url: publicUrl(path, base),
      method: "POST",
      body,
      retries,
      // The longest on the Free plan. Pro allows up to 3600.
      timeoutSeconds: Number(process.env.JOBS_TIMEOUT_SECONDS) || 300,
      callbackUrl: null,
    }),
  })
  if (!response.ok) throw new Error(`CloudHike Jobs answered ${response.status}: ${await response.text()}`)
  const run = (await response.json()) as JobRun
  return run.id
}

export async function getJobRun(id: string) {
  const response = await jobsRequest(`/runs/${id}`)
  if (!response.ok) throw new Error(`CloudHike Jobs answered ${response.status}: ${await response.text()}`)
  return (await response.json()) as JobRun
}

/** Whether a request really came from CloudHike Jobs, and recently. */
export function verifyJobSignature(body: string, header: string | null) {
  const parts = Object.fromEntries((header ?? "").split(",").map((part) => part.split("=")))
  const timestamp = Number(parts.t)
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300 || !process.env.JOBS_API_KEY) return false
  const expected = Buffer.from(createHmac("sha256", process.env.JOBS_API_KEY).update(`${timestamp}.${body}`).digest("hex"))
  const actual = Buffer.from(parts.v1 ?? "")
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
