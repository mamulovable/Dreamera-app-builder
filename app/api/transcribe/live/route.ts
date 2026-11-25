import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"

import { AiProviderError } from "@/lib/ai/providers"
import { liveTranscribeConfigured } from "@/lib/ai/live-transcribe"
import { createLiveTranscribeSession } from "@/lib/ai/live-transcribe-sessions"
import { PlanLimitError, planLimitResponse, spendCredits, refundCredits } from "@/lib/billing/credits"
import { AI_VOICE_CREDITS } from "@/lib/plans"
import { getCurrentUser } from "@/lib/session"
import { isVoiceLanguageCode } from "@/lib/voice"

function error(message: string, status: number, code?: string) {
  return NextResponse.json(code ? { error: message, code } : { error: message }, { status })
}

/**
 * Starts a server-side Gemini Live transcription session for builder voice prompts.
 * The browser streams PCM to follow-up routes; the API key never leaves the server.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser().catch(() => null)
  if (!user) return error("Please sign in to use voice dictation.", 401)

  if (!liveTranscribeConfigured()) {
    return error("Voice dictation isn't available right now.", 503)
  }

  const body = (await request.json().catch(() => null)) as { language?: unknown } | null
  const rawLanguage = typeof body?.language === "string" ? body.language.trim().toLowerCase() : "auto"
  const language = isVoiceLanguageCode(rawLanguage) ? rawLanguage : "auto"

  const reference = `voice-live:${randomUUID()}`
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
    const session = await createLiveTranscribeSession(user.id, language)
    return NextResponse.json({
      sessionId: session.sessionId,
      model: session.model,
      reference,
    })
  } catch (cause) {
    await refundCredits(user.id, AI_VOICE_CREDITS, {
      reference: `refund:${reference}`,
    }).catch(() => {})
    if (cause instanceof AiProviderError) return error(cause.message, cause.status)
    console.error("Builder live voice session failed", cause)
    return error("Voice dictation isn't available right now.", 502)
  }
}
