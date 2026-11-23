import { randomUUID } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"
import { eq } from "drizzle-orm"

import { db, projects } from "@/db"
import { recordAiCall, type AiCallTask } from "@/lib/ai/log"
import { AiProviderError, SPEECH_CHAR_LIMIT, aiModelFor, analyzeImage, completeText, synthesizeSpeech, transcribeAudio, type AiResult } from "@/lib/ai/providers"
import type { AiTurn } from "@/lib/ai/types"
import { assertAiBudget } from "@/lib/ai/usage"
import { PlanLimitError, refundCredits, spendCredits } from "@/lib/billing/credits"
import { AI_SPEECH_CREDITS, AI_TEXT_CREDITS, AI_VISION_CREDITS, AI_VOICE_CREDITS } from "@/lib/plans"

// Phones and the sandboxed preview call this. It uses no cookies. Audio and photos
// are too large for the data API, so they have this route of their own.
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_AUDIO_BYTES = 10 * 1024 * 1024
const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const MAX_PROMPT = 4000
const MAX_HISTORY = 12
const MAX_TURN = 2000
const MAX_QUESTION = 2000
const AUDIO_TYPE = /^(audio\/[\w.+-]+|video\/(mp4|webm|mpeg))$/

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
  return rate.count > 20
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS })
}

function fail(message: string, status: number) {
  return json({ message }, status)
}

function cleanHistory(value: unknown): AiTurn[] {
  if (!Array.isArray(value)) return []
  const turns: AiTurn[] = []
  for (const item of value.slice(-MAX_HISTORY)) {
    if (!item || typeof item !== "object") continue
    const role = (item as { role?: unknown }).role
    const content = (item as { content?: unknown }).content
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") continue
    const text = content.trim().slice(0, MAX_TURN)
    if (text) turns.push({ role, content: text })
  }
  return turns
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  if (!UUID_PATTERN.test(projectId)) return fail("This app doesn't have AI.", 404)

  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  if (limited(projectId, address)) return fail("Too many AI requests. Try again in a minute.", 429)

  const [project] = await db
    .select({ id: projects.id, userId: projects.userId, aiEnabled: projects.aiEnabled })
    .from(projects)
    .where(eq(projects.id, projectId))
  if (!project?.aiEnabled) return fail("AI isn't turned on for this app.", 403)

  const contentType = request.headers.get("content-type") ?? ""
  let cost = 0
  let task: AiCallTask = "text"
  let inputPreview = ""
  let inputBytes: number | null = null
  let run: () => Promise<AiResult>

  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as { task?: unknown; prompt?: unknown; text?: unknown; history?: unknown } | null
    if (body?.task === "speech") {
      const spoken = typeof body.text === "string" ? body.text.trim() : ""
      if (!spoken || spoken.length > SPEECH_CHAR_LIMIT) return fail("That line is too long to speak.", 400)
      cost = AI_SPEECH_CREDITS
      task = "speech"
      inputPreview = spoken
      run = () => synthesizeSpeech(spoken)
    } else if (body?.task === "text") {
      const prompt = typeof body.prompt === "string" ? body.prompt.trim() : ""
      if (!prompt || prompt.length > MAX_PROMPT) return fail("Type a shorter message.", 400)
      cost = AI_TEXT_CREDITS
      task = "text"
      inputPreview = prompt
      const history = cleanHistory(body.history)
      run = () => completeText(prompt, history)
    } else {
      return fail("This call isn't a text question.", 400)
    }
  } else if (contentType.includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null)
    if (!form) return fail("That file didn't upload.", 400)
    const formTask = String(form.get("task") ?? "")
    const file = form.get("file")
    if (!(file instanceof File)) return fail("Attach a file.", 400)
    if (formTask === "transcribe") {
      if (file.size <= 0 || file.size > MAX_AUDIO_BYTES) return fail("That recording is too large. Keep it under a minute.", 413)
      const audioType = file.type.split(";")[0].trim()
      if (audioType && !AUDIO_TYPE.test(audioType)) return fail("That file isn't an audio recording.", 400)
      cost = AI_VOICE_CREDITS
      task = "transcribe"
      inputPreview = "Voice recording"
      inputBytes = file.size
      run = () => transcribeAudio(file, file.name || "note.m4a")
    } else if (formTask === "vision") {
      const question = String(form.get("question") ?? "").trim()
      if (!question || question.length > MAX_QUESTION) return fail("Ask a shorter question about the photo.", 400)
      if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) return fail("That photo is too large.", 413)
      cost = AI_VISION_CREDITS
      task = "vision"
      inputPreview = question
      inputBytes = file.size
      run = () => analyzeImage(file, question)
    } else {
      return fail("This AI call isn't recognized.", 400)
    }
  } else {
    return fail("This AI call isn't recognized.", 400)
  }

  const started = Date.now()
  const log = (entry: Omit<Parameters<typeof recordAiCall>[0], "projectId" | "task" | "inputPreview" | "inputBytes">) =>
    recordAiCall({ projectId: project.id, task, model: aiModelFor(task), inputPreview, inputBytes, ...entry })

  try {
    await assertAiBudget(project.id, cost)
  } catch (error) {
    if (error instanceof AiProviderError) {
      await log({ status: "blocked", credits: 0, error: error.message, durationMs: Date.now() - started })
      return fail(error.message, error.status)
    }
    throw error
  }

  const reference = `ai:${randomUUID()}`
  try {
    await spendCredits(project.userId, cost, { reason: "ai", projectId: project.id, reference })
  } catch (error) {
    if (error instanceof PlanLimitError) {
      await log({ status: "blocked", credits: 0, error: "Out of AI credits.", durationMs: Date.now() - started })
      return fail("This app's owner is out of AI credits.", 402)
    }
    throw error
  }

  try {
    const result = await run()
    await log({
      status: "succeeded",
      model: result.model,
      credits: cost,
      usage: result.usage,
      outputPreview: result.text,
      durationMs: Date.now() - started,
    })
    return json(result.audio ? { audio: result.audio } : { text: result.text })
  } catch (error) {
    let refunded = false
    try {
      await refundCredits(project.userId, cost, { projectId: project.id, reference: `refund:${reference}` })
      refunded = true
    } catch (refundError) {
      console.error("AI credit refund failed", refundError)
    }
    const message = error instanceof AiProviderError ? error.message : "AI couldn't answer. Try again."
    if (!(error instanceof AiProviderError)) console.error("AI call failed", error)
    await log({
      status: "failed",
      credits: cost,
      refunded,
      error: error instanceof AiProviderError && error.detail ? error.detail : message,
      durationMs: Date.now() - started,
    })
    return fail(message, error instanceof AiProviderError ? error.status : 502)
  }
}
