import { randomBytes, randomUUID } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"

import { RecordInputError } from "@/lib/cloudhike/app-schema"
import {
  RecordLimitError,
  cleanFields,
  deleteFile,
  deleteRecord,
  deleteValue,
  deviceOwner,
  ensureAppDatabase,
  fileDownloadUrl,
  fileUploadUrl,
  getGatewayApp,
  getRecord,
  getValue,
  insertRecord,
  isRateLimited,
  isUploadKey,
  listRecords,
  ownerFolder,
  ownerFromToken,
  setValue,
  updateRecord,
  type GatewayApp,
  type Owner,
} from "@/lib/cloudhike/gateway"
import { safeFileName } from "@/lib/storage"

// Generated apps call this from phones and from the preview's sandboxed frame.
// It uses no cookies, so allowing every origin gives a site nothing it didn't have.
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, x-device-id",
  "access-control-max-age": "86400",
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COLLECTION_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const DEVICE_ID = /^[a-f0-9]{64}$/
const MAX_BODY_BYTES = 128 * 1024
const MAX_ID_LENGTH = 200
const UPLOAD_TYPE = /^(image|video|audio)\/[\w.+-]+$|^application\/pdf$/
const MAX_EMAIL_TEXT = 20_000

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS })
}

function fail(message: string, status: number) {
  return json({ message }, status)
}

async function readBody(request: NextRequest) {
  const text = await request.text()
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return { tooLarge: true as const }
  try {
    return { value: JSON.parse(text) as unknown }
  } catch {
    return { value: null }
  }
}

/** Who's calling: a signed-in person, or else one install of the app. Null if it's neither. */
async function resolveOwner(request: NextRequest, app: GatewayApp): Promise<Owner | null> {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (token) return ownerFromToken(app.env, token)
  const device = request.headers.get("x-device-id")
  return device && DEVICE_ID.test(device) ? deviceOwner(device) : null
}

async function handle(request: NextRequest, { params }: { params: Promise<{ projectId: string; path: string[] }> }) {
  const { projectId, path } = await params
  if (!UUID_PATTERN.test(projectId)) return fail("This app isn't connected to a backend.", 404)

  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  if (isRateLimited(projectId, address)) return fail("Too many requests. Try again in a minute.", 429)

  const app = await getGatewayApp(projectId)
  if (!app) return fail("This app isn't connected to a backend.", 404)

  const [resource, ...rest] = path
  const method = request.method

  // Files are opened by image components, which can't send headers. Keys are unguessable.
  if (resource === "files" && method === "GET") {
    const key = rest.join("/")
    if (!app.s3 || !isUploadKey(key)) return fail("File not found.", 404)
    return NextResponse.redirect(await fileDownloadUrl(app, key), { status: 302, headers: { "cache-control": "private, max-age=1800" } })
  }

  // A new install's id comes from here, since not every phone can make a secure random value.
  if (resource === "devices" && method === "POST") return json({ deviceId: randomBytes(32).toString("hex") }, 201)

  const owner = await resolveOwner(request, app)
  if (!owner) return fail("Sign in again to continue.", 401)

  if (resource === "collections") {
    if (!app.sql) return fail("This app's database isn't deployed.", 503)
    const [name, id] = rest
    if (!name || !COLLECTION_NAME.test(name) || rest.length > 2) return fail("Not found.", 404)
    if (id && id.length > MAX_ID_LENGTH) return fail("Not found.", 404)
    const table = app.tables.get(name)
    if (!table) return fail(`This app doesn't store ${name}.`, 404)
    await ensureAppDatabase(app)

    if (!id && method === "GET") return json({ items: await listRecords(app.sql, table, owner) })
    if (id && method === "GET") {
      const record = await getRecord(app.sql, table, id, owner)
      return record ? json(record) : fail("Not found.", 404)
    }
    if (id && method === "DELETE") {
      await deleteRecord(app.sql, table, id, owner)
      return json({ ok: true })
    }
    if ((!id && method === "POST") || (id && method === "PATCH")) {
      const body = await readBody(request)
      if ("tooLarge" in body) return fail("That's too much to save at once.", 413)
      const fields = cleanFields(body.value)
      if (!fields) return fail("Send the record's fields as JSON.", 400)
      if (id) {
        const record = await updateRecord(app.sql, table, id, owner, fields)
        return record ? json(record) : fail("Not found.", 404)
      }
      return json(await insertRecord(app.sql, table, randomUUID(), owner, fields), 201)
    }
    return fail("Not found.", 404)
  }

  if (resource === "values") {
    if (!app.sql) return fail("This app's database isn't deployed.", 503)
    const key = rest.join("/")
    if (!key || key.length > MAX_ID_LENGTH) return fail("Not found.", 404)
    await ensureAppDatabase(app)
    if (method === "GET") return json({ value: await getValue(app.sql, key, owner) })
    if (method === "PUT") {
      const body = await readBody(request)
      if ("tooLarge" in body) return fail("That's too much to save at once.", 413)
      await setValue(app.sql, key, owner, (body.value as { value?: unknown } | null)?.value ?? null)
      return json({ ok: true })
    }
    if (method === "DELETE") {
      await deleteValue(app.sql, key, owner)
      return json({ ok: true })
    }
    return fail("Not found.", 404)
  }

  if (resource === "files") {
    if (!app.s3) return fail("This app's file storage isn't deployed.", 503)
    const body = await readBody(request)
    if ("tooLarge" in body) return fail("Not found.", 413)
    const input = (body.value ?? {}) as { name?: unknown; contentType?: unknown; url?: unknown }

    if (method === "POST") {
      const name = safeFileName(typeof input.name === "string" ? input.name : "file")
      const contentType = typeof input.contentType === "string" && UPLOAD_TYPE.test(input.contentType) ? input.contentType : "application/octet-stream"
      const key = `uploads/${ownerFolder(owner)}/${randomUUID()}-${name}`
      const url = new URL(`/api/apps/${projectId}/files/${key}`, process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin)
      return json({ uploadUrl: await fileUploadUrl(app, key, contentType), contentType, url: url.toString(), name }, 201)
    }
    if (method === "DELETE") {
      const key = typeof input.url === "string" ? input.url.split(`/api/apps/${projectId}/files/`)[1] : undefined
      // Only the folder of the person asking: the url alone is enough to read a file, not to delete it.
      if (key && isUploadKey(key) && key.startsWith(`uploads/${ownerFolder(owner)}/`)) await deleteFile(app, key)
      return json({ ok: true })
    }
    return fail("Not found.", 404)
  }

  // Goes only to the signed-in person's own address, so the app's public API can't be used to mail strangers.
  if (resource === "email" && method === "POST") {
    if (!app.env.EMAIL_API_URL || !app.env.EMAIL_API_KEY) return fail("This app's email isn't deployed.", 503)
    if (!owner.signedIn || !owner.email) return fail("Sign in to get emails.", 401)
    const body = await readBody(request)
    if ("tooLarge" in body) return fail("That email is too long.", 413)
    const { subject, text } = (body.value ?? {}) as { subject?: unknown; text?: unknown }
    if (typeof subject !== "string" || !subject.trim() || subject.length > 200 || /[\r\n]/.test(subject)) return fail("Give the email a one-line subject.", 400)
    if (typeof text !== "string" || !text.trim() || text.length > MAX_EMAIL_TEXT) return fail("Give the email some text.", 400)

    const response = await fetch(`${app.env.EMAIL_API_URL.replace(/\/$/, "")}/send`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": app.env.EMAIL_API_KEY },
      body: JSON.stringify({ to: owner.email, subject, text, ...(app.env.EMAIL_FROM ? { from: app.env.EMAIL_FROM } : {}) }),
      cache: "no-store",
    })
    if (response.status === 429) return fail("The app has sent too many emails. Try again later.", 429)
    if (!response.ok) throw new Error(`CloudHike Email answered ${response.status}.`)
    return json({ ok: true })
  }

  return fail("Not found.", 404)
}

async function respond(request: NextRequest, context: { params: Promise<{ projectId: string; path: string[] }> }) {
  try {
    return await handle(request, context)
  } catch (error) {
    if (error instanceof RecordLimitError) return fail(error.message, 413)
    if (error instanceof RecordInputError) return fail(error.message, 400)
    console.error("A generated app's request failed", error)
    // The database may be asleep or paused. The app keeps what it has and tries again.
    return fail("The app's backend isn't reachable right now.", 503)
  }
}

export const GET = respond
export const POST = respond
export const PUT = respond
export const PATCH = respond
export const DELETE = respond

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}
