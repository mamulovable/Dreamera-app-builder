import { geminiCredentials } from "@/lib/agent/provider-settings"
import { AiProviderError } from "@/lib/ai/providers"
import type { VoiceLanguageCode } from "@/lib/voice"

/** Realtime speech-to-text for builder voice prompts. */
export const GEMINI_LIVE_TRANSCRIBE_MODEL = () =>
  process.env.GEMINI_LIVE_TRANSCRIBE_MODEL?.trim() || "gemini-3.5-transcribe-live"

const LIVE_WS_PATH =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained"

/** ISO-639-1 (builder UI) → BCP-47 hints Gemini Live expects. */
const LANGUAGE_HINTS: Record<Exclude<VoiceLanguageCode, "auto">, string[]> = {
  en: ["en-US"],
  fr: ["fr-FR"],
  es: ["es-419", "es-US"],
  pt: ["pt-BR", "pt-PT"],
  de: ["de-DE"],
  it: ["it-IT"],
  nl: ["nl-NL"],
  ar: ["ar-EG"],
  yo: [],
  ha: ["ha-NG"],
  sw: ["sw-KE"],
  zh: ["cmn-Hans-CN"],
  ja: ["ja-JP"],
  ko: ["ko-KR"],
  hi: ["hi-IN"],
  tr: ["tr-TR"],
  ru: ["ru-RU"],
  pl: ["pl-PL"],
  uk: ["uk-UA"],
  vi: ["vi-VN"],
  id: ["id-ID"],
  th: ["th-TH"],
}

export function liveTranscribeLanguageCodes(language: VoiceLanguageCode): string[] {
  if (language === "auto") return []
  return LANGUAGE_HINTS[language] ?? []
}

export function liveTranscribeConfigured() {
  return Boolean(geminiCredentials()?.apiKey)
}

export function liveTranscribeSetup(languageCodes: string[]) {
  // Gemini rejects responseModalities on the setup root; it belongs in generationConfig.
  return {
    model: `models/${GEMINI_LIVE_TRANSCRIBE_MODEL()}`,
    generationConfig: {
      responseModalities: ["TEXT"],
    },
    // Push-to-talk: the mic button owns turn boundaries.
    realtimeInputConfig: {
      automaticActivityDetection: {
        disabled: true,
      },
    },
    inputAudioTranscription: {
      languageCodes,
      mode: "SMART",
    },
  }
}

export function liveTranscribeWsUrl(accessToken: string) {
  return `${LIVE_WS_PATH}?access_token=${encodeURIComponent(accessToken)}`
}

/**
 * Short-lived token so the browser can open Gemini Live without our API key.
 * Works on Vercel — no sticky server-side WebSocket required.
 */
export async function createLiveTranscribeToken(language: VoiceLanguageCode) {
  const credentials = geminiCredentials()
  if (!credentials) throw new AiProviderError("Voice dictation isn't available right now.", 503)

  const languageCodes = liveTranscribeLanguageCodes(language)
  const setup = liveTranscribeSetup(languageCodes)
  const now = Date.now()
  const body = {
    expireTime: new Date(now + 10 * 60_000).toISOString(),
    newSessionExpireTime: new Date(now + 2 * 60_000).toISOString(),
    uses: 1,
  }

  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/auth_tokens", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": credentials.apiKey,
    },
    body: JSON.stringify(body),
    cache: "no-store",
  })
  const data = (await response.json().catch(() => null)) as { name?: unknown; error?: { message?: unknown } } | null
  if (!response.ok) {
    const detail = typeof data?.error?.message === "string" ? data.error.message : ""
    console.error(`Gemini live token ${response.status}`, detail.slice(0, 400))
    throw new AiProviderError("Voice dictation isn't available right now.", 502, detail || undefined)
  }
  const token = typeof data?.name === "string" ? data.name : ""
  if (!token) throw new AiProviderError("Voice dictation isn't available right now.", 502)

  return {
    token,
    model: GEMINI_LIVE_TRANSCRIBE_MODEL(),
    languageCodes,
    setup,
    wsUrl: liveTranscribeWsUrl(token),
  }
}
