import { NextResponse } from "next/server"
import { and, eq } from "drizzle-orm"

import { db, projects } from "@/db"
import { PlanLimitError, planLimitResponse, refundCredits, spendCredits } from "@/lib/billing/credits"
import { IMAGE_CREDITS } from "@/lib/plans"
import { ImageKitError, UPLOADABLE_IMAGE_TYPES, generateImage, transformImage, uploadImage } from "@/lib/imagekit"
import { getCurrentUser } from "@/lib/session"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const MAX_PROMPT_LENGTH = 500

// The AI can take up to a minute and a half, and then the result is saved.
export const maxDuration = 120

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

/**
 * Makes an image for the person's app and answers with its url. Putting that url in
 * the screen's code is a normal edit, which saves through the files route.
 */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const user = await getCurrentUser().catch(() => null)
  if (!user) return error("Please sign in to continue.", 401)
  if (!UUID_PATTERN.test(projectId)) return error("Project not found.", 404)

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
  if (!project) return error("Project not found.", 404)

  try {
    if (request.headers.get("content-type")?.startsWith("multipart/form-data")) {
      const form = await request.formData().catch(() => null)
      const file = form?.get("file")
      if (!(file instanceof File)) return error("Invalid request.", 400)
      if (!UPLOADABLE_IMAGE_TYPES.includes(file.type)) return error("Choose a JPG, PNG, WebP, or GIF image.", 400)
      if (file.size > MAX_UPLOAD_BYTES) return error("Choose an image under 10 MB.", 400)
      return NextResponse.json({ url: await uploadImage(project.id, new Uint8Array(await file.arrayBuffer()), file.type) })
    }

    const body = (await request.json().catch(() => null)) as { action?: unknown; prompt?: unknown; sourceUrl?: unknown } | null
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : ""
    if (!prompt) return error("Describe what you'd like first.", 400)
    if (prompt.length > MAX_PROMPT_LENGTH) return error(`Keep your description under ${MAX_PROMPT_LENGTH} characters.`, 400)
    const { action, sourceUrl } = body ?? {}
    if (action !== "generate" && !(action === "transform" && typeof sourceUrl === "string")) return error("Invalid request.", 400)

    const reference = `image:${crypto.randomUUID()}`
    await spendCredits(user.id, IMAGE_CREDITS, { reason: "image", projectId: project.id, reference })
    try {
      const url = await (action === "generate" ? generateImage(project.id, prompt) : transformImage(project.id, sourceUrl as string, prompt))
      return NextResponse.json({ url })
    } catch (cause) {
      await refundCredits(user.id, IMAGE_CREDITS, { projectId: project.id, reference: `refund:${reference}` })
      throw cause
    }
  } catch (cause) {
    if (cause instanceof PlanLimitError) return planLimitResponse(cause)
    if (cause instanceof ImageKitError) return error(cause.message, cause.status)
    console.error("An image request failed", cause)
    return error("Couldn't finish this image. Please try again.", 502)
  }
}
