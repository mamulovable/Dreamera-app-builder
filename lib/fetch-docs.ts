// Fetches public https documentation for the planner. Strips HTML to text.
// Reuses SSRF checks from the external proxy. Server-only.

import { assertPublicHttpsUrl, ExternalProxyError } from "@/lib/external-proxy"

const MAX_BYTES = 400_000
const MAX_CHARS = 24_000
const TIMEOUT_MS = 15_000

const DOC_HOST_HINTS = [
  "openweathermap.org",
  "openrouter.ai",
  "docs.openrouter.ai",
  "platform.openai.com",
  "developers.google.com",
  "docs.mapbox.com",
  "stripe.com",
  "twilio.com",
  "remove.bg",
  "cloudhike.dev",
  "developer.mozilla.org",
]

export class DocsFetchError extends Error {
  constructor(message: string) {
    super(message)
  }
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|h[1-6]|li|tr|br|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
}

export async function fetchPublicDocs(rawUrl: string): Promise<{ url: string; title: string; text: string }> {
  let target: URL
  try {
    target = await assertPublicHttpsUrl(rawUrl)
  } catch (error) {
    if (error instanceof ExternalProxyError) throw new DocsFetchError(error.message)
    throw new DocsFetchError("Give a valid https documentation URL.")
  }

  const host = target.hostname.toLowerCase()
  const known = DOC_HOST_HINTS.some((hint) => host === hint || host.endsWith(`.${hint}`))

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(target.toString(), {
      method: "GET",
      headers: {
        accept: "text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.8",
        "user-agent": "DreameraDocsBot/1.0 (+https://dreamera.app)",
      },
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new DocsFetchError("That documentation page took too long to load.")
    }
    throw new DocsFetchError("Couldn't reach that documentation page. If it redirects, open the final docs URL and try that.")
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) {
    throw new DocsFetchError(`The docs page answered ${response.status}.`)
  }

  const raw = Buffer.from(await response.arrayBuffer())
  if (raw.byteLength > MAX_BYTES) {
    throw new DocsFetchError("That documentation page is too large to read in one go. Use a more specific docs URL.")
  }

  const contentType = response.headers.get("content-type") ?? ""
  let text: string
  if (contentType.includes("application/json")) {
    text = raw.toString("utf8")
  } else if (contentType.includes("text/plain") || contentType.includes("markdown")) {
    text = raw.toString("utf8")
  } else {
    text = stripHtml(raw.toString("utf8"))
  }

  if (!text || text.length < 40) {
    throw new DocsFetchError("Couldn't extract useful text from that page. Try a different docs URL.")
  }

  const titleMatch = raw.toString("utf8").match(/<title[^>]*>([^<]+)<\/title>/i)
  const title = titleMatch?.[1]?.replace(/\s+/g, " ").trim() || target.hostname

  const clipped = text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n\n[…truncated…]` : text
  const hint = known ? "" : "\n\n(Note: this host isn't in the common API docs list — double-check the page is official documentation.)"

  return { url: target.toString(), title, text: clipped + hint }
}
