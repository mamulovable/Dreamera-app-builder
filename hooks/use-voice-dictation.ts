"use client"

import * as React from "react"

import { isUpgradeReason } from "@/lib/plans"
import { MAX_VOICE_SECONDS, type VoiceLanguageCode } from "@/lib/voice"
import { useUpgradeDialog } from "@/components/billing/upgrade-dialog"

type VoicePhase = "idle" | "connecting" | "recording" | "finalizing"

type UseVoiceDictationOptions = {
  language: VoiceLanguageCode
  disabled?: boolean
  onPartial?: (text: string | null) => void
  onTranscript: (text: string) => void
  onNeedAuth?: () => void
  onCharged?: () => void
}

type LiveSessionPayload = {
  wsUrl: string
  setup: Record<string, unknown>
}

const TARGET_RATE = 16_000
const PCM_MIME = "audio/pcm;rate=16000"

function floatTo16BitPcm(input: Float32Array) {
  const buffer = new ArrayBuffer(input.length * 2)
  const view = new DataView(buffer)
  for (let i = 0; i < input.length; i++) {
    const sample = Math.max(-1, Math.min(1, input[i]!))
    view.setInt16(i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }
  return buffer
}

function downsample(buffer: Float32Array, fromRate: number, toRate: number) {
  if (fromRate === toRate) return buffer
  const ratio = fromRate / toRate
  const length = Math.max(1, Math.round(buffer.length / ratio))
  const result = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    result[i] = buffer[Math.min(buffer.length - 1, Math.floor(i * ratio))]!
  }
  return result
}

function encodeBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  const chunk = 0x8000
  let binary = ""
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function readTranscription(value: unknown): string {
  if (!value || typeof value !== "object") return ""
  const text = (value as { text?: unknown }).text
  return typeof text === "string" ? text : ""
}

async function parseSocketMessage(data: unknown): Promise<Record<string, unknown> | null> {
  try {
    let text = ""
    if (typeof data === "string") text = data
    else if (typeof Blob !== "undefined" && data instanceof Blob) text = await data.text()
    else if (data instanceof ArrayBuffer) text = new TextDecoder().decode(data)
    else if (ArrayBuffer.isView(data)) {
      text = new TextDecoder().decode(data as ArrayBufferView)
    } else return null
    if (!text) return null
    return JSON.parse(text) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Realtime voice dictation via Gemini Live (`gemini-3.5-transcribe-live`).
 * Browser opens Gemini with a short-lived token from `/api/transcribe/live`.
 */
export function useVoiceDictation({
  language,
  disabled,
  onPartial,
  onTranscript,
  onNeedAuth,
  onCharged,
}: UseVoiceDictationOptions) {
  const openUpgrade = useUpgradeDialog()
  const [phase, setPhase] = React.useState<VoicePhase>("idle")
  const [error, setError] = React.useState<string | null>(null)
  const [elapsed, setElapsed] = React.useState(0)
  const [liveText, setLiveText] = React.useState("")

  const languageRef = React.useRef(language)
  const onPartialRef = React.useRef(onPartial)
  const onTranscriptRef = React.useRef(onTranscript)
  const onChargedRef = React.useRef(onCharged)

  const wsRef = React.useRef<WebSocket | null>(null)
  const streamRef = React.useRef<MediaStream | null>(null)
  const audioContextRef = React.useRef<AudioContext | null>(null)
  const processorRef = React.useRef<ScriptProcessorNode | null>(null)
  const sourceRef = React.useRef<MediaStreamAudioSourceNode | null>(null)
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null)
  const stopAtRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const setupReadyRef = React.useRef(false)
  const stoppingRef = React.useRef(false)
  const finalTextRef = React.useRef("")
  const interimRef = React.useRef("")
  const finalizeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopRef = React.useRef<(() => void) | null>(null)

  React.useEffect(() => {
    languageRef.current = language
    onPartialRef.current = onPartial
    onTranscriptRef.current = onTranscript
    onChargedRef.current = onCharged
  })

  const publishLive = React.useCallback((finalText: string, interim: string) => {
    finalTextRef.current = finalText
    interimRef.current = interim
    const next = interim ? (finalText ? `${finalText} ${interim}` : interim) : finalText
    setLiveText(next)
    onPartialRef.current?.(next || null)
  }, [])

  const cleanupAudio = React.useCallback(() => {
    try {
      processorRef.current?.disconnect()
    } catch {
      // ignore
    }
    try {
      sourceRef.current?.disconnect()
    } catch {
      // ignore
    }
    processorRef.current = null
    sourceRef.current = null
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const cleanupSession = React.useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    if (stopAtRef.current) clearTimeout(stopAtRef.current)
    stopAtRef.current = null
    if (finalizeTimerRef.current) clearTimeout(finalizeTimerRef.current)
    finalizeTimerRef.current = null
    cleanupAudio()
    const ws = wsRef.current
    wsRef.current = null
    setupReadyRef.current = false
    stoppingRef.current = false
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      try {
        ws.close()
      } catch {
        // ignore
      }
    }
  }, [cleanupAudio])

  React.useEffect(() => () => cleanupSession(), [cleanupSession])

  const finishWithText = React.useCallback(
    (text: string) => {
      cleanupSession()
      setLiveText("")
      onPartialRef.current?.(null)
      setElapsed(0)
      setPhase("idle")
      const trimmed = text.trim()
      if (!trimmed) {
        setError("No speech was heard. Try again.")
        return
      }
      onTranscriptRef.current(trimmed)
    },
    [cleanupSession]
  )

  const sendJson = React.useCallback((payload: unknown) => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify(payload))
  }, [])

  const attachMicStreaming = React.useCallback(
    async (stream: MediaStream) => {
      streamRef.current = stream

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const audioContext = new AudioCtx()
      audioContextRef.current = audioContext
      if (audioContext.state === "suspended") await audioContext.resume()

      const source = audioContext.createMediaStreamSource(stream)
      sourceRef.current = source
      const processor = audioContext.createScriptProcessor(4096, 1, 1)
      processorRef.current = processor

      processor.onaudioprocess = (event) => {
        if (!setupReadyRef.current || stoppingRef.current) return
        const input = event.inputBuffer.getChannelData(0)
        const down = downsample(input, audioContext.sampleRate, TARGET_RATE)
        if (down.length === 0) return
        sendJson({
          realtimeInput: {
            audio: {
              mimeType: PCM_MIME,
              data: encodeBase64(floatTo16BitPcm(down)),
            },
          },
        })
      }

      const mute = audioContext.createGain()
      mute.gain.value = 0
      source.connect(processor)
      processor.connect(mute)
      mute.connect(audioContext.destination)

      sendJson({ realtimeInput: { activityStart: {} } })
      setPhase("recording")
      setElapsed(0)
      const startedAt = Date.now()
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAt) / 1000))
      }, 250)
      stopAtRef.current = setTimeout(() => {
        void stopRef.current?.()
      }, MAX_VOICE_SECONDS * 1000)
    },
    [sendJson]
  )

  const openLiveSession = React.useCallback(
    async (session: LiveSessionPayload, stream: MediaStream) => {
      await new Promise<void>((resolve, reject) => {
        let settled = false
        const fail = (message: string) => {
          if (settled) return
          settled = true
          reject(new Error(message))
        }
        const ok = () => {
          if (settled) return
          settled = true
          resolve()
        }

        const ws = new WebSocket(session.wsUrl)
        ws.binaryType = "arraybuffer"
        wsRef.current = ws
        let opened = false

        const readyTimeout = setTimeout(() => {
          fail(
            opened
              ? "Gemini Live connected but never finished setup. Try again."
              : "Couldn't open a Live connection to Gemini from this browser. Try again, or check that WebSockets aren't blocked."
          )
          try {
            ws.close()
          } catch {
            // ignore
          }
        }, 15_000)

        const clearReadyTimeout = () => clearTimeout(readyTimeout)
        const failAndClear = (message: string) => {
          clearReadyTimeout()
          fail(message)
        }
        const okAndClear = () => {
          clearReadyTimeout()
          ok()
        }

        ws.onopen = () => {
          opened = true
          try {
            ws.send(JSON.stringify({ setup: session.setup }))
          } catch {
            failAndClear("Couldn't start live transcription. Try again.")
          }
        }

        ws.onerror = () => {
          failAndClear("Couldn't reach Gemini Live. Check your connection and try again.")
        }

        ws.onclose = (event) => {
          if (setupReadyRef.current || stoppingRef.current) return
          const detail = event.reason?.trim()
          failAndClear(
            detail ? `Live transcription closed: ${detail}` : "Couldn't start live transcription. Try again."
          )
        }

        ws.onmessage = (event) => {
          void (async () => {
            const message = await parseSocketMessage(event.data)
            if (!message) return

            const apiError = message.error as { message?: unknown } | undefined
            if (apiError) {
              const detail = typeof apiError.message === "string" ? apiError.message : ""
              failAndClear(detail || "Couldn't start live transcription. Try again.")
              try {
                ws.close()
              } catch {
                // ignore
              }
              return
            }

            if (message.setupComplete !== undefined) {
              // Handshake done — don't let mic wiring count against the connect timeout.
              clearReadyTimeout()
              setupReadyRef.current = true
              try {
                await attachMicStreaming(stream)
                okAndClear()
              } catch (cause) {
                failAndClear(cause instanceof Error ? cause.message : "Microphone access was blocked.")
              }
              return
            }

            const serverContent = message.serverContent as Record<string, unknown> | undefined
            if (!serverContent) return

            const interim = readTranscription(serverContent.interimInputTranscription)
            if (interim) publishLive(finalTextRef.current, interim)

            if (serverContent.inputTranscription !== undefined) {
              const finalPiece = readTranscription(serverContent.inputTranscription)
              publishLive(finalPiece, "")
              if (stoppingRef.current) {
                if (finalizeTimerRef.current) clearTimeout(finalizeTimerRef.current)
                finishWithText(finalPiece)
              }
            }

            if (
              stoppingRef.current &&
              (serverContent.generationComplete === true || serverContent.turnComplete === true) &&
              finalTextRef.current
            ) {
              if (finalizeTimerRef.current) clearTimeout(finalizeTimerRef.current)
              finishWithText(finalTextRef.current)
            }
          })()
        }
      })
    },
    [attachMicStreaming, finishWithText, publishLive]
  )

  const start = React.useCallback(async () => {
    if (disabled || phase !== "idle") return
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Voice dictation isn't supported in this browser.")
      return
    }
    if (typeof WebSocket === "undefined") {
      setError("Voice dictation isn't supported in this browser.")
      return
    }

    setError(null)
    setLiveText("")
    finalTextRef.current = ""
    interimRef.current = ""
    onPartialRef.current?.(null)
    setPhase("connecting")

    let stream: MediaStream | null = null
    try {
      // Ask for the mic first so the permission prompt doesn't eat the Live connect timeout.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
      streamRef.current = stream

      const response = await fetch("/api/transcribe/live", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language: languageRef.current }),
      })
      const data = await response.json().catch(() => null)
      if (response.status === 401) {
        stream.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        setPhase("idle")
        onNeedAuth?.()
        return
      }
      if (!response.ok) {
        if (isUpgradeReason(data?.code)) openUpgrade(data.code)
        throw new Error(data?.error || "Couldn't start live transcription. Try again.")
      }
      const wsUrl = typeof data?.wsUrl === "string" ? data.wsUrl : ""
      const setup = data?.setup && typeof data.setup === "object" ? (data.setup as Record<string, unknown>) : null
      if (!wsUrl || !setup) throw new Error("Couldn't start live transcription. Try again.")

      await openLiveSession({ wsUrl, setup }, stream)
      onChargedRef.current?.()
    } catch (cause) {
      stream?.getTracks().forEach((track) => track.stop())
      cleanupSession()
      setPhase("idle")
      setLiveText("")
      onPartialRef.current?.(null)
      const message =
        cause instanceof Error && /Permission|NotAllowed|Denied/i.test(cause.message)
          ? "Microphone access was blocked. Allow it in your browser settings to dictate."
          : cause instanceof Error
            ? cause.message
            : "Couldn't start live transcription. Try again."
      setError(message)
    }
  }, [cleanupSession, disabled, onNeedAuth, openLiveSession, openUpgrade, phase])

  const stop = React.useCallback(() => {
    if (phase !== "recording" && phase !== "connecting") return
    if (stoppingRef.current) return
    stoppingRef.current = true
    setPhase("finalizing")

    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    if (stopAtRef.current) clearTimeout(stopAtRef.current)
    stopAtRef.current = null

    cleanupAudio()

    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN || !setupReadyRef.current) {
      finishWithText(finalTextRef.current)
      return
    }

    try {
      ws.send(JSON.stringify({ realtimeInput: { activityEnd: {} } }))
    } catch {
      finishWithText(finalTextRef.current)
      return
    }

    finalizeTimerRef.current = setTimeout(() => {
      finishWithText(finalTextRef.current || interimRef.current)
    }, 2500)
  }, [cleanupAudio, finishWithText, phase])

  stopRef.current = stop

  const toggle = React.useCallback(() => {
    if (disabled) return
    if (phase === "recording" || phase === "connecting") stop()
    else if (phase === "idle") void start()
  }, [disabled, phase, start, stop])

  const cancel = React.useCallback(() => {
    if (phase === "idle" || phase === "finalizing") return
    cleanupSession()
    setLiveText("")
    onPartialRef.current?.(null)
    setElapsed(0)
    setPhase("idle")
    setError(null)
  }, [cleanupSession, phase])

  return {
    phase,
    error,
    elapsed,
    liveText,
    recording: phase === "recording" || phase === "connecting",
    busy: phase === "connecting" || phase === "finalizing",
    toggle,
    cancel,
    clearError: () => setError(null),
  }
}
