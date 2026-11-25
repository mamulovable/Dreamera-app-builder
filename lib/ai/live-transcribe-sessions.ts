import { randomUUID } from "node:crypto"
import WebSocket from "ws"

import { geminiCredentials } from "@/lib/agent/provider-settings"
import { AiProviderError } from "@/lib/ai/providers"
import {
  GEMINI_LIVE_TRANSCRIBE_MODEL,
  liveTranscribeLanguageCodes,
  liveTranscribeSetup,
} from "@/lib/ai/live-transcribe"
import type { VoiceLanguageCode } from "@/lib/voice"

export type LiveTranscriptEvent =
  | { type: "ready" }
  | { type: "partial"; text: string }
  | { type: "final"; text: string }
  | { type: "error"; message: string }
  | { type: "closed" }

type Listener = (event: LiveTranscriptEvent) => void

type LiveSession = {
  id: string
  userId: string
  ws: WebSocket
  ready: boolean
  finalText: string
  interimText: string
  listeners: Set<Listener>
  createdAt: number
  closesAt: ReturnType<typeof setTimeout>
}

const SESSION_TTL_MS = 3 * 60_000

function store() {
  const globalStore = globalThis as typeof globalThis & {
    __dreameraLiveVoiceSessions?: Map<string, LiveSession>
  }
  if (!globalStore.__dreameraLiveVoiceSessions) {
    globalStore.__dreameraLiveVoiceSessions = new Map()
  }
  return globalStore.__dreameraLiveVoiceSessions
}

function readTranscription(value: unknown): string {
  if (!value || typeof value !== "object") return ""
  const text = (value as { text?: unknown }).text
  return typeof text === "string" ? text : ""
}

function emit(session: LiveSession, event: LiveTranscriptEvent) {
  for (const listener of session.listeners) {
    try {
      listener(event)
    } catch {
      // ignore listener errors
    }
  }
}

function destroySession(id: string, notify = true) {
  const sessions = store()
  const session = sessions.get(id)
  if (!session) return
  sessions.delete(id)
  clearTimeout(session.closesAt)
  if (session.ws.readyState === WebSocket.OPEN || session.ws.readyState === WebSocket.CONNECTING) {
    try {
      session.ws.close()
    } catch {
      // ignore
    }
  }
  if (notify) emit(session, { type: "closed" })
  session.listeners.clear()
}

/**
 * Opens a Gemini Live transcription socket on the server (keeps the API key off the browser).
 */
export async function createLiveTranscribeSession(userId: string, language: VoiceLanguageCode) {
  const credentials = geminiCredentials()
  if (!credentials) throw new AiProviderError("Voice dictation isn't available right now.", 503)

  const languageCodes = liveTranscribeLanguageCodes(language)
  const setup = liveTranscribeSetup(languageCodes)
  const id = randomUUID()
  const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(credentials.apiKey)}`

  const ws = new WebSocket(url)

  const session: LiveSession = {
    id,
    userId,
    ws,
    ready: false,
    finalText: "",
    interimText: "",
    listeners: new Set(),
    createdAt: Date.now(),
    closesAt: setTimeout(() => destroySession(id), SESSION_TTL_MS),
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const fail = (message: string) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      clearTimeout(session.closesAt)
      try {
        ws.close()
      } catch {
        // ignore
      }
      store().delete(id)
      reject(new AiProviderError(message, 502))
    }
    const ok = () => {
      if (settled) return
      settled = true
      resolve()
    }

    const timeout = setTimeout(() => fail("Live transcription timed out while connecting."), 12_000)

    ws.on("open", () => {
      try {
        ws.send(JSON.stringify({ setup }))
      } catch {
        clearTimeout(timeout)
        fail("Couldn't start live transcription. Try again.")
      }
    })

    ws.on("error", (cause) => {
      console.error("Gemini live socket error", cause)
      clearTimeout(timeout)
      fail("Couldn't reach Gemini Live. Try again.")
    })

    ws.on("close", (code, reasonBuf) => {
      clearTimeout(timeout)
      if (!session.ready) {
        const reason = reasonBuf?.toString?.().trim?.() || ""
        console.error(`Gemini live closed before ready (${code})`, reason.slice(0, 400))
        fail(reason || "Couldn't start live transcription. Try again.")
        return
      }
      destroySession(id)
    })

    ws.on("message", (raw) => {
      let message: Record<string, unknown>
      try {
        message = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf8")) as Record<string, unknown>
      } catch {
        return
      }

      const apiError = message.error as { message?: unknown } | undefined
      if (apiError) {
        const detail = typeof apiError.message === "string" ? apiError.message : ""
        console.error("Gemini live setup error", detail.slice(0, 400))
        clearTimeout(timeout)
        emit(session, { type: "error", message: detail || "Couldn't start live transcription. Try again." })
        fail(detail || "Couldn't start live transcription. Try again.")
        return
      }

      if (message.setupComplete !== undefined) {
        session.ready = true
        clearTimeout(timeout)
        store().set(id, session)
        emit(session, { type: "ready" })
        ok()
        return
      }

      const serverContent = message.serverContent as Record<string, unknown> | undefined
      if (!serverContent) return

      const interim = readTranscription(serverContent.interimInputTranscription)
      if (interim) {
        session.interimText = interim
        const text = session.finalText ? `${session.finalText} ${interim}` : interim
        emit(session, { type: "partial", text })
      }

      if (serverContent.inputTranscription !== undefined) {
        const finalText = readTranscription(serverContent.inputTranscription)
        session.finalText = finalText
        session.interimText = ""
        emit(session, { type: "final", text: finalText })
        emit(session, { type: "partial", text: finalText })
      }
    })
  })

  return {
    sessionId: id,
    model: GEMINI_LIVE_TRANSCRIBE_MODEL(),
  }
}

export function getLiveTranscribeSession(sessionId: string, userId: string) {
  const session = store().get(sessionId)
  if (!session || session.userId !== userId) return null
  return session
}

export function subscribeLiveTranscribe(sessionId: string, userId: string, listener: Listener) {
  const session = getLiveTranscribeSession(sessionId, userId)
  if (!session) return () => {}
  session.listeners.add(listener)
  if (session.ready) listener({ type: "ready" })
  if (session.finalText || session.interimText) {
    const text = session.interimText
      ? session.finalText
        ? `${session.finalText} ${session.interimText}`
        : session.interimText
      : session.finalText
    listener({ type: "partial", text })
  }
  return () => {
    session.listeners.delete(listener)
  }
}

export function sendLiveAudio(sessionId: string, userId: string, pcmBase64: string) {
  const session = getLiveTranscribeSession(sessionId, userId)
  if (!session?.ready || session.ws.readyState !== WebSocket.OPEN) return false
  session.ws.send(
    JSON.stringify({
      realtimeInput: {
        audio: {
          mimeType: "audio/pcm;rate=16000",
          data: pcmBase64,
        },
      },
    })
  )
  return true
}

export function sendLiveActivity(sessionId: string, userId: string, kind: "start" | "end") {
  const session = getLiveTranscribeSession(sessionId, userId)
  if (!session?.ready || session.ws.readyState !== WebSocket.OPEN) return false
  session.ws.send(
    JSON.stringify({
      realtimeInput: kind === "start" ? { activityStart: {} } : { activityEnd: {} },
    })
  )
  return true
}

export function closeLiveTranscribeSession(sessionId: string, userId: string) {
  const session = getLiveTranscribeSession(sessionId, userId)
  if (!session) return ""
  const text = session.finalText || session.interimText
  destroySession(sessionId)
  return text
}
