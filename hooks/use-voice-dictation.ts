"use client"

import * as React from "react"

import { isUpgradeReason } from "@/lib/plans"
import { MAX_VOICE_SECONDS, type VoiceLanguageCode } from "@/lib/voice"
import { useUpgradeDialog } from "@/components/billing/upgrade-dialog"

type VoicePhase = "idle" | "connecting" | "recording" | "finalizing"

type UseVoiceDictationOptions = {
  language: VoiceLanguageCode
  disabled?: boolean
  /**
   * Live session text while speaking (SMART transcript / interim preview).
   * `null` when the session ends or is cancelled.
   */
  onPartial?: (text: string | null) => void
  /** Final cleaned transcript when the user stops the mic. */
  onTranscript: (text: string) => void
  onNeedAuth?: () => void
  onCharged?: () => void
}

const TARGET_RATE = 16_000

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

/**
 * Realtime voice dictation via Gemini Live (`gemini-3.5-transcribe-live`).
 * The browser captures PCM; our server holds the Gemini socket.
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

  const sessionIdRef = React.useRef<string | null>(null)
  const eventSourceRef = React.useRef<EventSource | null>(null)
  const streamRef = React.useRef<MediaStream | null>(null)
  const audioContextRef = React.useRef<AudioContext | null>(null)
  const processorRef = React.useRef<ScriptProcessorNode | null>(null)
  const sourceRef = React.useRef<MediaStreamAudioSourceNode | null>(null)
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null)
  const stopAtRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const sendingRef = React.useRef(false)
  const finalTextRef = React.useRef("")
  const stopRef = React.useRef<(() => void) | null>(null)

  React.useEffect(() => {
    languageRef.current = language
    onPartialRef.current = onPartial
    onTranscriptRef.current = onTranscript
    onChargedRef.current = onCharged
  })

  const publishLive = React.useCallback((text: string) => {
    finalTextRef.current = text
    setLiveText(text)
    onPartialRef.current?.(text || null)
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
    cleanupAudio()
    eventSourceRef.current?.close()
    eventSourceRef.current = null
    sendingRef.current = false
    sessionIdRef.current = null
  }, [cleanupAudio])

  React.useEffect(() => () => cleanupSession(), [cleanupSession])

  const postAudio = React.useCallback(async (sessionId: string, payload: Record<string, unknown>) => {
    try {
      await fetch(`/api/transcribe/live/${sessionId}/audio`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      })
    } catch {
      // Drop a chunk rather than killing the whole dictation.
    }
  }, [])

  const startMicStreaming = React.useCallback(
    async (sessionId: string) => {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      })
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

      let queue: Promise<void> = Promise.resolve()
      processor.onaudioprocess = (event) => {
        if (!sendingRef.current) return
        const input = event.inputBuffer.getChannelData(0)
        const down = downsample(input, audioContext.sampleRate, TARGET_RATE)
        if (down.length === 0) return
        const pcm = encodeBase64(floatTo16BitPcm(down))
        queue = queue.then(() => postAudio(sessionId, { pcm }))
      }

      const mute = audioContext.createGain()
      mute.gain.value = 0
      source.connect(processor)
      processor.connect(mute)
      mute.connect(audioContext.destination)

      sendingRef.current = true
      await postAudio(sessionId, { activity: "start" })
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
    [postAudio]
  )

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

  const start = React.useCallback(async () => {
    if (disabled || phase !== "idle") return
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Voice dictation isn't supported in this browser.")
      return
    }

    setError(null)
    setLiveText("")
    finalTextRef.current = ""
    onPartialRef.current?.(null)
    setPhase("connecting")

    try {
      const response = await fetch("/api/transcribe/live", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ language: languageRef.current }),
      })
      const data = await response.json().catch(() => null)
      if (response.status === 401) {
        setPhase("idle")
        onNeedAuth?.()
        return
      }
      if (!response.ok) {
        if (isUpgradeReason(data?.code)) openUpgrade(data.code)
        throw new Error(data?.error || "Couldn't start live transcription. Try again.")
      }

      const sessionId = typeof data?.sessionId === "string" ? data.sessionId : ""
      if (!sessionId) throw new Error("Couldn't start live transcription. Try again.")
      sessionIdRef.current = sessionId
      onChargedRef.current?.()

      await new Promise<void>((resolve, reject) => {
        const events = new EventSource(`/api/transcribe/live/${sessionId}/events`)
        eventSourceRef.current = events
        let ready = false

        const fail = (message: string) => {
          events.close()
          reject(new Error(message))
        }

        const readyTimeout = setTimeout(() => {
          fail("Live transcription timed out while connecting. Try again.")
        }, 12_000)

        events.onmessage = (event) => {
          let payload: { type?: string; text?: string; message?: string }
          try {
            payload = JSON.parse(event.data) as { type?: string; text?: string; message?: string }
          } catch {
            return
          }

          if (payload.type === "ready") {
            if (ready) return
            ready = true
            clearTimeout(readyTimeout)
            void startMicStreaming(sessionId)
              .then(() => resolve())
              .catch((cause) => {
                fail(cause instanceof Error ? cause.message : "Microphone access was blocked.")
              })
            return
          }

          if (payload.type === "partial" && typeof payload.text === "string") {
            publishLive(payload.text)
            return
          }

          if (payload.type === "final" && typeof payload.text === "string") {
            publishLive(payload.text)
            return
          }

          if (payload.type === "error") {
            fail(payload.message || "Couldn't start live transcription. Try again.")
          }
        }

        events.onerror = () => {
          if (!ready) fail("Couldn't start live transcription. Try again.")
        }
      })
    } catch (cause) {
      cleanupSession()
      setPhase("idle")
      setLiveText("")
      onPartialRef.current?.(null)
      setError(cause instanceof Error ? cause.message : "Couldn't start live transcription. Try again.")
    }
  }, [cleanupSession, disabled, onNeedAuth, openUpgrade, phase, publishLive, startMicStreaming])

  const stop = React.useCallback(() => {
    if (phase !== "recording" && phase !== "connecting") return
    setPhase("finalizing")
    sendingRef.current = false

    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    if (stopAtRef.current) clearTimeout(stopAtRef.current)
    stopAtRef.current = null
    cleanupAudio()

    const sessionId = sessionIdRef.current
    if (!sessionId) {
      finishWithText(finalTextRef.current)
      return
    }

    void (async () => {
      try {
        const response = await fetch(`/api/transcribe/live/${sessionId}/stop`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ waitMs: 1500 }),
        })
        const data = await response.json().catch(() => null)
        const text =
          typeof data?.text === "string" && data.text.trim()
            ? data.text
            : finalTextRef.current
        finishWithText(text)
      } catch {
        finishWithText(finalTextRef.current)
      }
    })()
  }, [cleanupAudio, finishWithText, phase])

  stopRef.current = stop

  const toggle = React.useCallback(() => {
    if (disabled) return
    if (phase === "recording" || phase === "connecting") stop()
    else if (phase === "idle") void start()
  }, [disabled, phase, start, stop])

  const cancel = React.useCallback(() => {
    if (phase === "idle" || phase === "finalizing") return
    const sessionId = sessionIdRef.current
    if (sessionId) {
      void fetch(`/api/transcribe/live/${sessionId}/stop`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ waitMs: 0 }),
        keepalive: true,
      }).catch(() => {})
    }
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
