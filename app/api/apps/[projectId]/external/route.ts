import { NextResponse, type NextRequest } from "next/server"
import { eq } from "drizzle-orm"

import { db, projects } from "@/db"
import { ExternalProxyError, proxyExternalRequest } from "@/lib/external-proxy"
import { getSecretValue, normalizeSecretName } from "@/lib/project-secrets"

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const rates = new Map<string, { count: number; resets: number }>()

function limited(projectId: string, address: string) {
  const now = Date.now()
  if (rates.size > 5_000) rates.clear()
  const key = `${projectId}:${address}`
  const rate = rates.get(key)
  if (!rate || rate.resets <= now) {
    rates.set(key, { count: 1, resets: now + 60_000 })
    return false
  }
  rate.count += 1
  return rate.count > 30
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS })
}

function fail(message: string, status: number) {
  return json({ message }, status)
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  if (!UUID_PATTERN.test(projectId)) return fail("This app isn't available.", 404)

  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  if (limited(projectId, address)) return fail("Too many requests. Try again in a minute.", 429)

  const [project] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).limit(1)
  if (!project) return fail("This app isn't available.", 404)

  const body = (await request.json().catch(() => null)) as {
    secretName?: unknown
    url?: unknown
    method?: unknown
    headers?: unknown
    body?: unknown
    auth?: unknown
  } | null

  const secretName = normalizeSecretName(body?.secretName)
  if (!secretName) return fail("Send a stored secret name like OPENWEATHER_API_KEY.", 400)
  if (typeof body?.url !== "string") return fail("Send the https URL to call.", 400)

  const secretValue = await getSecretValue(projectId, secretName)
  if (!secretValue) return fail(`No API key named ${secretName} is stored for this app.`, 404)

  try {
    const result = await proxyExternalRequest(secretValue, {
      url: body.url,
      method: body.method,
      headers: body.headers,
      body: body.body,
      auth: body.auth,
    })
    // Always 200 with the wrapped upstream status so screens can branch on result.ok / result.status.
    return json(result)
  } catch (error) {
    if (error instanceof ExternalProxyError) return fail(error.message, error.status)
    console.error("External API proxy failed", error)
    return fail("The external API call failed.", 502)
  }
}
