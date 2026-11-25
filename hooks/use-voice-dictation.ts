"use client"

import * as React from "react"

import { isUpgradeReason } from "@/lib/plans"
import { MAX_VOICE_SECONDS, type VoiceLanguageCode } from "@/lib/voice"
import { useUpgradeDialog } from "@/components/billing/upgrade-dialog"

type VoicePhase = "idle" | "recording" | "transcribing"

type UseVoiceDictationOptions = {
  language: VoiceLanguageCode
  disabled?: boolean
  /** Called with the transcript when Whisper finishes. */
  onTranscript: (text: string) => void
  /** Called when the user isn't signed in and tries to record. */
  onNeedAuth?: () => void
  /** Refresh credits after a successful (paid) transcription. */
  onCharged?: () => void
}

/**
 * Records a short voice note in the browser and sends it to `/api/transcribe`.
 * Call `toggle()` from a mic button: start recording, then stop & transcribe.
 */
export function useVoiceDictation({
  language,
  disabled,
  onTranscript,
  onNeedAuth,
  onCharged,
}: UseVoiceDictationOptions) {
  const openUpgrade = useUpgradeDialog()
  const [phase, setPhase] = React.useState<VoicePhase>("idle")
  const [error, setError] = React.useState<string | null>(null)
  const [elapsed, setElapsed] = React.useState(0)

  const mediaRef = React.useRef<MediaRecorder | null>(null)
  const chunksRef = React.useRef<Blob[]>([])
  const streamRef = React.useRef<MediaStream | null>(null)
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null)
  const stopAtRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const languageRef = React.useRef(language)
  const onTranscriptRef = React.useRef(onTranscript)
  const onChargedRef = React.useRef(onCharged)

  React.useEffect(() => {
    languageRef.current = language
    onTranscriptRef.current = onTranscript
    onChargedRef.current = onCharged
  })

  const cleanupStream = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    mediaRef.current = null
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    if (stopAtRef.current) clearTimeout(stopAtRef.current)
    stopAtRef.current = null
  }, [])

  React.useEffect(() => () => cleanupStream(), [cleanupStream])

  const transcribe = React.useCallback(async (blob: Blob) => {
    setPhase("transcribing")
    setError(null)
    try {
      const form = new FormData()
      const extension = blob.type.includes("webm") ? "webm" : blob.type.includes("mp4") ? "mp4" : "wav"
      form.append("file", blob, `note.${extension}`)
      form.append("language", languageRef.current)
      const response = await fetch("/api/transcribe", { method: "POST", body: form })
      const data = await response.json().catch(() => null)
      if (response.status === 401) {
        setPhase("idle")
        onNeedAuth?.()
        return
      }
      if (!response.ok) {
        if (isUpgradeReason(data?.code)) openUpgrade(data.code)
        throw new Error(data?.error || "That recording couldn't be transcribed. Try again.")
      }
      const text = typeof data?.text === "string" ? data.text.trim() : ""
      if (!text) throw new Error("No speech was heard in that recording.")
      onTranscriptRef.current(text)
      onChargedRef.current?.()
      setPhase("idle")
      setElapsed(0)
    } catch (cause) {
      setPhase("idle")
      setElapsed(0)
      setError(cause instanceof Error ? cause.message : "That recording couldn't be transcribed. Try again.")
    }
  }, [onNeedAuth, openUpgrade])

  const stop = React.useCallback(() => {
    const recorder = mediaRef.current
    if (!recorder || recorder.state === "inactive") {
      cleanupStream()
      setPhase("idle")
      return
    }
    recorder.onstop = () => {
      const type = recorder.mimeType || "audio/webm"
      const blob = new Blob(chunksRef.current, { type })
      chunksRef.current = []
      cleanupStream()
      if (blob.size === 0) {
        setPhase("idle")
        setError("No speech was heard. Try again.")
        return
      }
      void transcribe(blob)
    }
    try {
      recorder.stop()
    } catch {
      cleanupStream()
      setPhase("idle")
    }
  }, [cleanupStream, transcribe])

  const start = React.useCallback(async () => {
    if (disabled || phase !== "idle") return
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("Voice dictation isn't supported in this browser.")
      return
    }
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const mime = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : ""
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }
      mediaRef.current = recorder
      recorder.start(250)
      setPhase("recording")
      setElapsed(0)
      const startedAt = Date.now()
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAt) / 1000))
      }, 250)
      stopAtRef.current = setTimeout(() => stop(), MAX_VOICE_SECONDS * 1000)
    } catch {
      cleanupStream()
      setPhase("idle")
      setError("Microphone access was blocked. Allow it in your browser settings to dictate.")
    }
  }, [cleanupStream, disabled, phase, stop])

  const toggle = React.useCallback(() => {
    if (disabled) return
    if (phase === "recording") stop()
    else if (phase === "idle") void start()
  }, [disabled, phase, start, stop])

  const cancel = React.useCallback(() => {
    if (phase !== "recording") return
    const recorder = mediaRef.current
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = () => {
        chunksRef.current = []
        cleanupStream()
        setPhase("idle")
        setElapsed(0)
      }
      try {
        recorder.stop()
      } catch {
        cleanupStream()
        setPhase("idle")
        setElapsed(0)
      }
    } else {
      cleanupStream()
      setPhase("idle")
      setElapsed(0)
    }
  }, [cleanupStream, phase])

  return {
    phase,
    error,
    elapsed,
    recording: phase === "recording",
    busy: phase === "transcribing",
    toggle,
    cancel,
    clearError: () => setError(null),
  }
}
