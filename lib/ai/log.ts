import { aiCalls, db, projects, users } from "@/db"
import type { AiUsage } from "@/lib/ai/providers"
import { eq } from "drizzle-orm"

const PREVIEW_LENGTH = 500

export type AiCallTask = "text" | "transcribe" | "speech" | "vision"
export type AiCallStatus = "succeeded" | "failed" | "blocked"

function preview(value: string | null | undefined) {
  const text = value?.trim()
  if (!text) return null
  return text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH)}…` : text
}

/** Writes one row for the admin AI log. A logging failure must not change the app's reply. */
export async function recordAiCall(entry: {
  projectId: string
  task: AiCallTask
  status: AiCallStatus
  model?: string | null
  credits: number
  refunded?: boolean
  usage?: AiUsage | null
  inputPreview?: string | null
  outputPreview?: string | null
  inputBytes?: number | null
  error?: string | null
  durationMs?: number | null
}) {
  try {
    const [owner] = await db
      .select({ userId: projects.userId, title: projects.title, email: users.email })
      .from(projects)
      .innerJoin(users, eq(users.id, projects.userId))
      .where(eq(projects.id, entry.projectId))
    if (!owner) return
    await db.insert(aiCalls).values({
      userId: owner.userId,
      projectId: entry.projectId,
      userEmail: owner.email,
      projectTitle: owner.title,
      task: entry.task,
      model: entry.model ?? null,
      status: entry.status,
      credits: entry.credits,
      refunded: entry.refunded ?? false,
      promptTokens: entry.usage?.promptTokens ?? null,
      completionTokens: entry.usage?.completionTokens ?? null,
      totalTokens: entry.usage?.totalTokens ?? null,
      audioSeconds: entry.usage?.audioSeconds ?? null,
      inputPreview: preview(entry.inputPreview),
      outputPreview: preview(entry.outputPreview),
      inputBytes: entry.inputBytes ?? null,
      error: entry.error ? entry.error.slice(0, 300) : null,
      durationMs: entry.durationMs ?? null,
    })
  } catch (error) {
    console.error("Couldn't record the AI call", error)
  }
}
