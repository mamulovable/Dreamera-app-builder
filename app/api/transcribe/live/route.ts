import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"

import { AiProviderError } from "@/lib/ai/providers"
import { createLiveTranscribeToken, liveTranscribeConfigured } from "@/lib/ai/live-transcribe"
import { PlanLimitError, planLimitResponse, spendCredits, refundCredits } from "@/lib/billing/credits"
import { AI_VOICE_CREDITS } from "@/lib/plans"
import { getCurrentUser } from "@/lib/session"
import { isVoiceLanguageCode } from "@/lib/voice"

function error(message: string, status: number, code?: string) {
  return NextResponse.json(code ? { error: message, code } : { error: message }, { status })
}

/**
 * Issues a short-lived Gemini Live token for realtime builder voice dictation.
 * The browser streams PCM straight to Gemini; this route only authenticates + bills.
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
    const session = await createLiveTranscribeToken(language)
    return NextResponse.json({
      token: session.token,
      wsUrl: session.wsUrl,
      model: session.model,
      setup: session.setup,
      reference,
    })
  } catch (cause) {
    await refundCredits(user.id, AI_VOICE_CREDITS, {
      reference: `refund:${reference}`,
    }).catch(() => {})
    if (cause instanceof AiProviderError) return error(cause.message, cause.status)
    console.error("Builder live voice token failed", cause)
    return error("Voice dictation isn't available right now.", 502)
  }
}
