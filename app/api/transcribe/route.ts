import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"

import { AiProviderError, aiProvidersConfigured, transcribeAudio } from "@/lib/ai/providers"
import { PlanLimitError, planLimitResponse, spendCredits, refundCredits } from "@/lib/billing/credits"
import { AI_VOICE_CREDITS } from "@/lib/plans"
import { getCurrentUser } from "@/lib/session"
import { isVoiceLanguageCode, MAX_VOICE_BYTES } from "@/lib/voice"

const AUDIO_TYPE = /^(audio\/[\w.+-]+|video\/(mp4|webm|mpeg))$/

function error(message: string, status: number, code?: string) {
  return NextResponse.json(code ? { error: message, code } : { error: message }, { status })
}

/**
 * Transcribes a short voice note for the builder prompt boxes (home + workspace).
 * Uses Groq Whisper. Optional `language` is an ISO-639-1 code, or "auto".
 */
export async function POST(request: Request) {
  const user = await getCurrentUser().catch(() => null)
  if (!user) return error("Please sign in to use voice dictation.", 401)

  if (!aiProvidersConfigured().voice) {
    return error("Voice dictation isn't available right now.", 503)
  }

  const form = await request.formData().catch(() => null)
  if (!form) return error("Invalid request.", 400)

  const file = form.get("file")
  if (!(file instanceof File) || file.size <= 0) return error("Record something first.", 400)
  if (file.size > MAX_VOICE_BYTES) return error("That recording is too large. Keep it under a minute.", 413)

  const audioType = file.type.split(";")[0].trim()
  if (audioType && !AUDIO_TYPE.test(audioType)) return error("That file isn't an audio recording.", 400)

  const rawLanguage = String(form.get("language") ?? "auto").trim().toLowerCase()
  const language = isVoiceLanguageCode(rawLanguage) ? rawLanguage : "auto"

  const reference = `voice:${randomUUID()}`
  try {
    await spendCredits(user.id, AI_VOICE_CREDITS, {
      reason: "ai",
      reference,
    })
  } catch (cause) {
    if (cause instanceof PlanLimitError) return planLimitResponse(cause)
    throw cause
  }

  try {
    const result = await transcribeAudio(file, file.name || "note.webm", language === "auto" ? null : language)
    return NextResponse.json({ text: result.text })
  } catch (cause) {
    await refundCredits(user.id, AI_VOICE_CREDITS, {
      reference: `refund:${reference}`,
    }).catch(() => {})
    if (cause instanceof AiProviderError) return error(cause.message, cause.status)
    console.error("Builder voice transcription failed", cause)
    return error("That recording couldn't be transcribed. Try again.", 502)
  }
}
