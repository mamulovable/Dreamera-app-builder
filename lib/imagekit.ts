// Server-only client for ImageKit, which stores the images people put in their apps
// and runs the AI that makes and changes them. Never import this from client components.
//
// A generated image is shown from ImageKit's own generation url, which has its prompt in
// the path (https://imagekit.io/docs/ai-transformations#generate-image-via-text-prompt). A
// phone can't show ImageKit's "still preparing" page, so that url only goes in an app's
// code once the image is ready. A transformed image is saved as a file of its own.

import { createHash, randomUUID } from "node:crypto"

import ImageKit, { toFile } from "@imagekit/nodejs"

/** Can take up to a minute, according to ImageKit. */
const AI_TIMEOUT_MS = 90_000
const POLL_INTERVAL_MS = 3_000
/** A build step has a time limit of its own, so a slow image gives way to a placeholder. */
const BUILD_AI_TIMEOUT_MS = 60_000
/** The most images one build step generates, since each one costs ImageKit units. */
const MAX_IMAGES_PER_STEP = 8

const GENERATED_IMAGE_PATH = "ik-genimg-prompt-"

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
}

export const UPLOADABLE_IMAGE_TYPES = Object.keys(EXTENSIONS)

/** A problem with a message that's safe to show the person. */
export class ImageKitError extends Error {
  constructor(
    message: string,
    readonly status = 502
  ) {
    super(message)
  }
}

/** ImageKit is only used when it's switched on and has its keys. Otherwise apps get placeholder images. */
export function isImageKitEnabled() {
  const { IMAGEKIT_ENABLED, IMAGEKIT_PRIVATE_KEY, IMAGEKIT_URL_ENDPOINT } = process.env
  return IMAGEKIT_ENABLED === "true" && Boolean(IMAGEKIT_PRIVATE_KEY && IMAGEKIT_URL_ENDPOINT)
}

function assertEnabled() {
  if (!isImageKitEnabled()) throw new ImageKitError("Image tools aren't turned on for this app.", 503)
}

let client: ImageKit | null = null

function getClient() {
  assertEnabled()
  client ??= new ImageKit({ privateKey: process.env.IMAGEKIT_PRIVATE_KEY })
  return client
}

function getEndpoint() {
  assertEnabled()
  return process.env.IMAGEKIT_URL_ENDPOINT!.replace(/\/+$/, "")
}

const projectFolder = (projectId: string) => `/appforge/${projectId}`

async function saveFile(projectId: string, file: Parameters<ImageKit["files"]["upload"]>[0]["file"], fileName: string) {
  const uploaded = await getClient().files.upload({
    file,
    fileName,
    folder: projectFolder(projectId),
    useUniqueFileName: true,
  })
  if (!uploaded.filePath) throw new Error("ImageKit didn't say where it saved the file.")
  return `${getEndpoint()}${uploaded.filePath}`
}

async function saveBytes(projectId: string, bytes: Uint8Array, contentType: string, name: string) {
  const fileName = `${name}.${EXTENSIONS[contentType] ?? "jpg"}`
  return saveFile(projectId, await toFile(bytes, fileName, { type: contentType }), fileName)
}

/** Waits for ImageKit to finish an AI url. It answers with a 200 and a web page until then. */
async function waitForImage(url: string, timeoutMs = AI_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs
  while (true) {
    // Without this, ImageKit can answer with a format like AVIF that phones can't all show.
    const response = await fetch(url, {
      headers: { Accept: "image/jpeg,image/png" },
      cache: "no-store",
      signal: AbortSignal.timeout(Math.max(deadline - Date.now(), 1_000)),
    })
    if (response.headers.get("is-intermediate-response") === "true") {
      await response.body?.cancel()
      if (Date.now() + POLL_INTERVAL_MS > deadline) {
        throw new ImageKitError("The AI is taking longer than usual. Please try again in a minute.", 504)
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      continue
    }
    const contentType = response.headers.get("content-type")?.split(";")[0].trim() ?? ""
    if (!response.ok || !contentType.startsWith("image/")) {
      await response.body?.cancel()
      console.error(`ImageKit answered an AI request with ${response.status} (${contentType}): ${response.headers.get("ik-error") ?? "no details"}`)
      throw new ImageKitError("The AI couldn't make this image. Try describing it differently, or try again in a few minutes.")
    }
    return { bytes: new Uint8Array(await response.arrayBuffer()), contentType }
  }
}

export async function uploadImage(projectId: string, bytes: Uint8Array, contentType: string) {
  return saveBytes(projectId, bytes, contentType, "upload")
}

/** The start of a generation url, for telling the agent how to write one. */
export function generatedImageUrlStart() {
  return `${getEndpoint()}/${GENERATED_IMAGE_PATH}`
}

/** The prompt has no encoded form in a generation url, so anything that would split the path or its string goes. */
function cleanPrompt(prompt: string) {
  return prompt.replace(/['"`]/g, "").replace(/[/\\,:?#%]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 500)
}

/** The generation url for an image in the project's folder, once ImageKit has finished it. */
async function prepareGeneratedImage(projectId: string, prompt: string, name: string, timeoutMs?: number) {
  const text = cleanPrompt(prompt)
  if (!text) throw new ImageKitError("Describe the image in words.", 400)
  const src = `/${GENERATED_IMAGE_PATH}${encodeURIComponent(text)}${projectFolder(projectId)}/${name}.jpg`
  // Signed, so these keep working if unsigned AI urls are restricted on the ImageKit account.
  const url = getClient().helper.buildSrc({ urlEndpoint: getEndpoint(), src, signed: true })
  await waitForImage(url, timeoutMs)
  return url
}

/** A new image each time, since the same path would give back the same image, whatever the prompt. */
export async function generateImage(projectId: string, prompt: string) {
  return prepareGeneratedImage(projectId, prompt, `generated-${randomUUID()}`)
}

/** Where `url` is in this project's folder, or null if ImageKit has to fetch a copy first. */
function pathInProject(projectId: string, url: URL) {
  const start = `${getEndpoint()}${projectFolder(projectId)}/`
  const plain = `${url.origin}${url.pathname}`
  return plain.startsWith(start) && !url.search ? plain.slice(getEndpoint().length) : null
}

export async function transformImage(projectId: string, sourceUrl: string, prompt: string) {
  const urlEndpoint = getEndpoint()
  const imagekit = getClient()
  let source: URL
  try {
    source = new URL(sourceUrl)
  } catch {
    throw new ImageKitError("This image's url isn't valid, so it can't be changed.", 400)
  }
  if (source.protocol !== "https:" && source.protocol !== "http:") {
    throw new ImageKitError("This image's url isn't valid, so it can't be changed.", 400)
  }
  // ImageKit does the fetching here, so a url someone typed never reaches into our own network.
  let src = pathInProject(projectId, source)
  if (!src) {
    const copy = await saveFile(projectId, source.href, "source.jpg").catch((cause) => {
      console.error("ImageKit couldn't fetch an image to change", cause)
      throw new ImageKitError("Couldn't load this image. Check that its url opens in a browser, or replace it first.")
    })
    src = copy.slice(urlEndpoint.length)
  }
  // Encoded, since a comma or a slash in plain text would end the transformation.
  const encoded = encodeURIComponent(Buffer.from(prompt, "utf8").toString("base64"))
  const url = imagekit.helper.buildSrc({ urlEndpoint, src, transformation: [{ aiEdit: `prompte-${encoded}` }], signed: true })
  const { bytes, contentType } = await waitForImage(url)
  return saveBytes(projectId, bytes, contentType, "edited")
}

// ---------- Images the agent asks for ----------

/** Every string in `value`, changed by `change`. */
function mapStrings<T>(value: T, change: (text: string) => string): T {
  if (typeof value === "string") return change(value) as T
  if (Array.isArray(value)) return value.map((inner) => mapStrings(inner, change)) as T
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, mapStrings(inner, change)])) as T
  }
  return value
}

/** The generation urls in `text` that the agent wrote, which aren't in a project's folder and ready yet. */
function replaceWrittenUrls(text: string, change: (written: { url: string; prompt: string; name: string }) => string) {
  if (!text.includes(GENERATED_IMAGE_PATH)) return text
  const start = `${getEndpoint()}/${GENERATED_IMAGE_PATH}`.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")
  const written = new RegExp(`${start}([^/"\`\\n]+)/([^"'\`\\s?]+)(?:\\?[^"'\`\\s]*)?`, "g")
  return text.replace(written, (url, prompt: string, name: string) => (name.startsWith("appforge/") ? url : change({ url, prompt, name })))
}

function placeholderImage(prompt: string) {
  const seed = cleanPrompt(prompt).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "image"
  return `https://picsum.photos/seed/${seed}/800/600`
}

function decodedPrompt(prompt: string) {
  try {
    return decodeURIComponent(prompt)
  } catch {
    return prompt
  }
}

export function hasGeneratedImages(value: unknown) {
  if (!isImageKitEnabled()) return false
  let found = false
  mapStrings(value, (text) =>
    replaceWrittenUrls(text, ({ url }) => {
      found = true
      return url
    })
  )
  return found
}

/**
 * `value`, which is code or data the agent wrote, with its generation urls moved to the
 * project's folder and ready to show. The file name comes from the prompt as well, so a
 * rewrite of a screen keeps its image, and one image is never mistaken for another. An image
 * that can't be made gets a placeholder, so a build never fails or shows a broken image over it.
 */
export async function fillGeneratedImages<T>(projectId: string, value: T): Promise<T> {
  if (!hasGeneratedImages(value)) return value
  const written = new Map<string, { prompt: string; name: string }>()
  mapStrings(value, (text) =>
    replaceWrittenUrls(text, ({ url, prompt, name }) => {
      written.set(url, { prompt: decodedPrompt(prompt), name })
      return url
    })
  )

  const finished = new Map<string, string>()
  await Promise.all(
    [...written].slice(0, MAX_IMAGES_PER_STEP).map(async ([url, { prompt, name }]) => {
      try {
        const hash = createHash("sha1").update(cleanPrompt(prompt)).digest("hex").slice(0, 8)
        const slug = name.split("/").pop()!.replace(/\.\w+$/, "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 40)
        finished.set(url, await prepareGeneratedImage(projectId, prompt, `${slug}-${hash}`, BUILD_AI_TIMEOUT_MS))
      } catch (cause) {
        console.error(`Generating an image for a build failed: "${prompt}"`, cause)
      }
    })
  )
  return mapStrings(value, (text) => replaceWrittenUrls(text, ({ url, prompt }) => finished.get(url) ?? placeholderImage(decodedPrompt(prompt))))
}
