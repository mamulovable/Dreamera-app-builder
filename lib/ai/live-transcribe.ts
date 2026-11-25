import { geminiCredentials } from "@/lib/agent/provider-settings"
import type { VoiceLanguageCode } from "@/lib/voice"

/** Realtime speech-to-text for builder voice prompts. */
export const GEMINI_LIVE_TRANSCRIBE_MODEL = () =>
  process.env.GEMINI_LIVE_TRANSCRIBE_MODEL?.trim() || "gemini-3.5-transcribe-live"

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
