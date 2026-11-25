// Languages for builder voice dictation (Whisper ISO-639-1 codes).

export const VOICE_LANGUAGES = [
  { code: "auto", label: "Auto-detect" },
  { code: "en", label: "English" },
  { code: "fr", label: "French" },
  { code: "es", label: "Spanish" },
  { code: "pt", label: "Portuguese" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "nl", label: "Dutch" },
  { code: "ar", label: "Arabic" },
  { code: "yo", label: "Yoruba" },
  { code: "ha", label: "Hausa" },
  { code: "sw", label: "Swahili" },
  { code: "zh", label: "Chinese" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "hi", label: "Hindi" },
  { code: "tr", label: "Turkish" },
  { code: "ru", label: "Russian" },
  { code: "pl", label: "Polish" },
  { code: "uk", label: "Ukrainian" },
  { code: "vi", label: "Vietnamese" },
  { code: "id", label: "Indonesian" },
  { code: "th", label: "Thai" },
] as const

export type VoiceLanguageCode = (typeof VOICE_LANGUAGES)[number]["code"]

export function isVoiceLanguageCode(value: unknown): value is VoiceLanguageCode {
  return VOICE_LANGUAGES.some((lang) => lang.code === value)
}

export function voiceLanguageLabel(code: string) {
  return VOICE_LANGUAGES.find((lang) => lang.code === code)?.label ?? "Auto-detect"
}

/** Keep voice notes short so prompts stay focused. */
export const MAX_VOICE_SECONDS = 60
export const MAX_VOICE_BYTES = 10 * 1024 * 1024
