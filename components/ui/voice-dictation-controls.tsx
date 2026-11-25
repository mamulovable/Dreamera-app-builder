"use client"

import * as React from "react"
import { CheckIcon, ChevronDownIcon, LanguagesIcon, MicIcon, SquareIcon } from "lucide-react"

import { useVoiceDictation } from "@/hooks/use-voice-dictation"
import {
  VOICE_LANGUAGES,
  voiceLanguageLabel,
  type VoiceLanguageCode,
} from "@/lib/voice"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"

const LANGUAGE_STORAGE_KEY = "appforge-voice-language"

function readStoredLanguage(): VoiceLanguageCode {
  if (typeof window === "undefined") return "auto"
  try {
    const saved = localStorage.getItem(LANGUAGE_STORAGE_KEY)
    if (saved && VOICE_LANGUAGES.some((lang) => lang.code === saved)) {
      return saved as VoiceLanguageCode
    }
  } catch {
    // ignore
  }
  return "auto"
}

/**
 * Compact mic control: tap to dictate, chevron opens language options.
 * Keeps speech + language as one toolbar unit instead of two pills.
 */
export function VoiceDictationControls({
  disabled,
  size = "default",
  onTranscript,
  onNeedAuth,
  onCharged,
  className,
}: {
  disabled?: boolean
  size?: "default" | "sm"
  onTranscript: (text: string) => void
  onNeedAuth?: () => void
  onCharged?: () => void
  className?: string
}) {
  const [language, setLanguage] = React.useState<VoiceLanguageCode>("auto")
  React.useEffect(() => {
    setLanguage(readStoredLanguage())
  }, [])

  const voice = useVoiceDictation({
    language,
    disabled,
    onTranscript,
    onNeedAuth,
    onCharged,
  })

  function chooseLanguage(code: VoiceLanguageCode) {
    setLanguage(code)
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, code)
    } catch {
      // ignore
    }
  }

  const compact = size === "sm"
  const idle = voice.phase === "idle"

  return (
    <div className={cn("flex flex-col items-start gap-1", className)}>
      <div
        className={cn(
          "inline-flex items-center overflow-hidden rounded-full",
          voice.recording
            ? "bg-red-500/12 ring-1 ring-red-500/20"
            : "hover:bg-muted/50"
        )}
      >
        <button
          type="button"
          disabled={disabled || voice.busy}
          onClick={voice.toggle}
          aria-label={
            voice.recording
              ? "Stop recording"
              : voice.busy
                ? "Transcribing"
                : `Dictate with your voice (${voiceLanguageLabel(language)})`
          }
          title={
            voice.recording
              ? `Recording… tap to stop (${voice.elapsed}s)`
              : `Speak your prompt · ${voiceLanguageLabel(language)}`
          }
          className={cn(
            "inline-flex items-center justify-center gap-1.5 text-muted-foreground transition-colors hover:text-brand-dark disabled:opacity-50",
            compact ? "size-8" : "h-9 px-2.5",
            voice.recording && "text-red-700 hover:text-red-800"
          )}
        >
          {voice.busy ? (
            <Spinner className="size-4" />
          ) : voice.recording ? (
            <>
              <span className="relative flex size-3.5 items-center justify-center">
                <span className="absolute size-3.5 animate-ping rounded-full bg-red-500/50" />
                <SquareIcon className="relative size-2.5 fill-current" />
              </span>
              {!compact && <span className="text-xs tabular-nums font-medium">{voice.elapsed}s</span>}
            </>
          ) : (
            <MicIcon className="size-4" />
          )}
        </button>

        {idle && (
          <>
            <span aria-hidden className="h-4 w-px bg-border/70" />
            <DropdownMenu>
              <DropdownMenuTrigger
                disabled={disabled}
                render={
                  <button
                    type="button"
                    aria-label={`Speech language: ${voiceLanguageLabel(language)}`}
                    title={`Speech language: ${voiceLanguageLabel(language)}`}
                    className={cn(
                      "inline-flex items-center justify-center text-muted-foreground transition-colors hover:text-brand-dark disabled:opacity-50",
                      compact ? "h-8 w-6" : "h-9 w-7"
                    )}
                  />
                }
              >
                <ChevronDownIcon className="size-3 opacity-70" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side={compact ? "top" : "bottom"}
                align="end"
                className="max-h-72 w-52 overflow-y-auto rounded-2xl"
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="flex items-center gap-1.5 px-2 text-[11px]">
                    <LanguagesIcon className="size-3" />
                    Speech language
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {VOICE_LANGUAGES.map((lang) => (
                    <DropdownMenuItem
                      key={lang.code}
                      className="rounded-xl"
                      onClick={() => chooseLanguage(lang.code)}
                    >
                      <span>{lang.label}</span>
                      {lang.code === language && <CheckIcon className="ml-auto text-brand" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>

      {voice.error && (
        <p role="alert" className="max-w-56 px-1 text-xs text-destructive">
          {voice.error}
        </p>
      )}
    </div>
  )
}
