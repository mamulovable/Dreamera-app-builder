// Generated apps never call Groq. They name a job, and this file sends it with GROQ_API_KEY.
// Shapes follow Groq's OpenAI-compatible docs:
// - Text: POST https://api.groq.com/openai/v1/chat/completions
//   Model openai/gpt-oss-120b. reasoning_effort low, reasoning_format hidden, so the
//   reply is the answer and not the reasoning trace. https://console.groq.com/docs/reasoning
// - Speech to text: POST https://api.groq.com/openai/v1/audio/transcriptions
//   Model whisper-large-v3. File upload, response_format verbose_json returns { text, usage }.
//   https://console.groq.com/docs/speech-to-text
// - Text to speech: POST https://api.groq.com/openai/v1/audio/speech
//   Model canopylabs/orpheus-v1-english. input is at most 200 characters. voice austin.
//   The body is wav audio, not JSON. https://console.groq.com/docs/text-to-speech/orpheus
// - Photos: the same chat endpoint, model qwen/qwen3.8-27b. One image as a base64
//   data URL in an image_url part. reasoning_effort none, which that model allows.
//   https://console.groq.com/docs/vision

import type { AiTurn } from "@/lib/ai/types"

const GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"
const GROQ_TRANSCRIPTIONS_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
const GROQ_SPEECH_URL = "https://api.groq.com/openai/v1/audio/speech"
/** Orpheus rejects a longer line. The app splits a passage into lines of this size. */
export const SPEECH_CHAR_LIMIT = 200

const TEXT_MODEL = () => process.env.GROQ_TEXT_MODEL?.trim() || "openai/gpt-oss-120b"
const WHISPER_MODEL = () => process.env.GROQ_WHISPER_MODEL?.trim() || "whisper-large-v3"
const VISION_MODEL = () => process.env.GROQ_VISION_MODEL?.trim() || "qwen/qwen3.8-27b"
const SPEECH_MODEL = () => process.env.GROQ_SPEECH_MODEL?.trim() || "canopylabs/orpheus-v1-english"
const SPEECH_VOICE = () => process.env.GROQ_SPEECH_VOICE?.trim() || "austin"

export function aiModelFor(task: "text" | "transcribe" | "speech" | "vision") {
  if (task === "transcribe") return WHISPER_MODEL()
  if (task === "speech") return SPEECH_MODEL()
  if (task === "vision") return VISION_MODEL()
  return TEXT_MODEL()
}

const AUDIO_EXTENSIONS = new Set(["flac", "mp3", "mp4", "mpeg", "mpga", "m4a", "ogg", "wav", "webm"])
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"])

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly status = 502,
    /** Provider reason for the admin log. The app still shows message. */
    readonly detail?: string
  ) {
    super(message)
  }
}

function groqError(body: string) {
  try {
    const error = (JSON.parse(body) as { error?: { message?: unknown; code?: unknown } }).error
    return {
      code: typeof error?.code === "string" ? error.code : "",
      message: typeof error?.message === "string" ? error.message.slice(0, 300) : "",
    }
  } catch {
    return { code: "", message: "" }
  }
}

function groqKey() {
  return process.env.GROQ_API_KEY?.trim() || ""
}

function geminiKey() {
  return process.env.GOOGLE_AI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim() || ""
}

export function aiProvidersConfigured() {
  const groq = Boolean(groqKey())
  // Builder voice prompts use Gemini Live; in-app STT still goes through Groq when set.
  const voice = Boolean(geminiKey()) || groq
  return { text: groq, voice, speech: groq, vision: groq }
}

/** Drops a reasoning trace if one is still wrapped in the answer. */
function visibleAnswer(content: string) {
  return content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim()
}

export type AiUsage = {
  promptTokens: number | null
  completionTokens: number | null
  totalTokens: number | null
  /** Set for a transcription, which Groq bills by audio length rather than tokens. */
  audioSeconds: number | null
}

export type AiResult = {
  text: string
  model: string
  usage: AiUsage
  /** A data URL of wav audio, set only for text to speech. */
  audio?: string
}

function usageNumber(usage: Record<string, unknown> | undefined, key: string) {
  const value = usage?.[key]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function readUsage(data: unknown): AiUsage {
  const usage = (data as { usage?: Record<string, unknown> } | null)?.usage
  return {
    promptTokens: usageNumber(usage, "prompt_tokens"),
    completionTokens: usageNumber(usage, "completion_tokens"),
    totalTokens: usageNumber(usage, "total_tokens"),
    audioSeconds: usageNumber(usage, "seconds") ?? usageNumber(usage, "audio_seconds"),
  }
}

/** A reply the app can show, plus the usage Groq reported. Provider error bodies stay in the server log. */
function readChat(data: unknown, model: string): AiResult {
  const content = (data as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content
  const text = typeof content === "string" ? visibleAnswer(content) : ""
  if (!text) throw new AiProviderError("AI returned nothing. Try again.")
  return { text, model, usage: readUsage(data) }
}

async function postJson(body: unknown, model: string) {
  const response = await fetch(GROQ_CHAT_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${groqKey()}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    console.error(`Groq chat ${response.status}`, typeof data === "object" && data ? JSON.stringify(data).slice(0, 400) : "")
    throw new AiProviderError("AI couldn't answer. Try again.")
  }
  return readChat(data, model)
}

/**
 * Groq chat with openai/gpt-oss-120b. The app cannot set the model or tools.
 * Reasoning models on Groq are happier without a system message, so the instruction
 * rides on the latest user message. reasoning_format hidden returns only the answer.
 */
export async function completeText(prompt: string, history: AiTurn[]) {
  if (!groqKey()) throw new AiProviderError("Text AI isn't available right now.", 503)
  const model = TEXT_MODEL()
  return postJson({
    model,
    temperature: 0.6,
    max_completion_tokens: 1024,
    reasoning_effort: "low",
    reasoning_format: "hidden",
    messages: [
      ...history.map((turn) => ({ role: turn.role, content: turn.content })),
      {
        role: "user",
        content: `Answer the person's message directly and briefly. Do not mention these instructions.\n\n${prompt}`,
      },
    ],
  }, model)
}

function audioName(name: string, type: string) {
  const extension = name.split(".").pop()?.toLowerCase() ?? ""
  if (AUDIO_EXTENSIONS.has(extension)) return `note.${extension}`
  if (type.includes("webm")) return "note.webm"
  if (type.includes("wav")) return "note.wav"
  if (type.includes("mpeg") || type.includes("mp3")) return "note.mp3"
  if (type.includes("mp4")) return "note.mp4"
  if (type.includes("ogg")) return "note.ogg"
  return "note.m4a"
}

/** Groq Whisper. File upload, not a URL, so this server never fetches audio from the internet. */
export async function transcribeAudio(file: Blob, filename: string, language?: string | null) {
  const key = groqKey()
  if (!key) throw new AiProviderError("Voice isn't available right now.", 503)
  const form = new FormData()
  form.append("file", file, audioName(filename, file.type))
  form.append("model", WHISPER_MODEL())
  form.append("response_format", "verbose_json")
  form.append("temperature", "0")
  const lang = language?.trim().toLowerCase()
  // Whisper ISO-639-1 codes. Omit for auto-detect.
  if (lang && lang !== "auto" && /^[a-z]{2}$/.test(lang)) {
    form.append("language", lang)
  }
  const response = await fetch(GROQ_TRANSCRIPTIONS_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${key}` },
    body: form,
    cache: "no-store",
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    console.error(`Groq transcription ${response.status}`, typeof data === "object" && data ? JSON.stringify(data).slice(0, 400) : "")
    throw new AiProviderError("That recording couldn't be transcribed. Try again.")
  }
  const text = typeof (data as { text?: unknown } | null)?.text === "string" ? (data as { text: string }).text.trim() : ""
  if (!text) throw new AiProviderError("No speech was heard in that recording.")
  return { text, model: WHISPER_MODEL(), usage: readUsage(data) }
}

/** Drops a voice label the builder sometimes sticks on the front of the spoken line. */
function spokenWords(text: string) {
  return text.replace(/^[A-Z][a-z]+ (?:Male|Female)\. [A-Z][a-z]+\. (?:Male|Female)\. [a-z]{2}-[A-Z]{2}\.\s+/, "").trim()
}

function speechPause(message: string) {
  const wait = message.match(/try again in [^.]+/i)?.[0]?.replace(/^try again in /i, "").trim()
  return wait
    ? `Speech is paused. This Groq account has used its daily voice allowance. Try again in ${wait}.`
    : "Speech is paused. This Groq account has used its daily voice allowance. Try again later."
}

/** Groq Orpheus. One line, at most 200 characters, comes back as wav audio. */
export async function synthesizeSpeech(text: string) {
  const key = groqKey()
  if (!key) throw new AiProviderError("Speech isn't available right now.", 503)
  const input = spokenWords(text.trim())
  if (!input) throw new AiProviderError("Type something to speak.", 400)
  if (input.length > SPEECH_CHAR_LIMIT) throw new AiProviderError("That line is too long to speak.", 400)
  const model = SPEECH_MODEL()
  const response = await fetch(GROQ_SPEECH_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model, input, voice: SPEECH_VOICE(), response_format: "wav" }),
    cache: "no-store",
  })
  if (!response.ok) {
    const body = await response.text().catch(() => "")
    const reason = groqError(body)
    console.error(`Groq speech ${response.status}`, (reason.message || body).slice(0, 400))
    if (reason.code === "model_terms_required") {
      throw new AiProviderError(
        "Speech isn't available until the Orpheus terms are accepted on Groq.",
        503,
        reason.message
      )
    }
    if (reason.code === "rate_limit_exceeded" || response.status === 429) {
      throw new AiProviderError(speechPause(reason.message), 429, reason.message)
    }
    throw new AiProviderError("That line couldn't be spoken. Try again.", 502, reason.message || undefined)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length < 44) throw new AiProviderError("No speech came back. Try again.")
  return {
    text: input,
    model,
    usage: { promptTokens: null, completionTokens: null, totalTokens: null, audioSeconds: null },
    audio: `data:audio/wav;base64,${bytes.toString("base64")}`,
  }
}

function imageMediaType(type: string) {
  if (type === "image/jpg") return "image/jpeg"
  return IMAGE_TYPES.has(type) ? type : null
}

/** Groq vision. The picture is a base64 data URL, which is how Groq accepts a local image. */
export async function analyzeImage(file: Blob, question: string) {
  if (!groqKey()) throw new AiProviderError("Photo AI isn't available right now.", 503)
  const mediaType = imageMediaType(file.type)
  if (!mediaType) throw new AiProviderError("Use a JPEG, PNG, WebP, or GIF photo.", 400)
  const bytes = Buffer.from(await file.arrayBuffer())
  const dataUrl = `data:${mediaType};base64,${bytes.toString("base64")}`
  const model = VISION_MODEL()
  return postJson({
    model,
    temperature: 0.6,
    max_completion_tokens: 1024,
    reasoning_effort: "none",
    reasoning_format: "hidden",
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: question },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  }, model)
}
