"use client"

import * as React from "react"
import { CheckCircle2Icon, ImageIcon, Loader2Icon, MicIcon, SparklesIcon, TypeIcon } from "lucide-react"

import type { AppAiAvailability } from "@/lib/ai/types"
import { AI_DAILY_CREDIT_CAP, AI_TEXT_CREDITS, AI_VISION_CREDITS, AI_VOICE_CREDITS } from "@/lib/plans"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

const JOBS = [
  { key: "text" as const, icon: TypeIcon, label: "Text", detail: `${AI_TEXT_CREDITS} credit a reply` },
  { key: "voice" as const, icon: MicIcon, label: "Voice", detail: `${AI_VOICE_CREDITS} credit a note` },
  { key: "vision" as const, icon: ImageIcon, label: "Photos", detail: `${AI_VISION_CREDITS} credits a photo` },
]

export function AiDialog({
  projectId,
  open,
  onOpenChange,
  enabled,
  credits,
  onChange,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  enabled: boolean
  credits: number
  onChange: (enabled: boolean) => Promise<boolean>
}) {
  const [availability, setAvailability] = React.useState<AppAiAvailability | null>(null)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setError(null)
    fetch(`/api/projects/${projectId}/ai`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null)
        if (!response.ok) throw new Error(body?.error ?? "Couldn't check AI.")
        setAvailability(body)
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return
        setError(cause instanceof Error ? cause.message : "Couldn't check AI.")
      })
    return () => controller.abort()
  }, [open, projectId])

  const ready = availability ? availability.text || availability.voice || availability.vision : false

  async function setEnabled(next: boolean) {
    setPending(true)
    setError(null)
    if (!(await onChange(next))) setError(next ? "We couldn't turn AI on. Please try again." : "We couldn't turn AI off. Please try again.")
    setPending(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 rounded-3xl p-6 sm:max-w-md">
        <DialogHeader className="flex-row items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-brand/15 to-brand-accent/15 text-brand">
            <SparklesIcon className="size-5" />
          </span>
          <div className="min-w-0 space-y-0.5">
            <DialogTitle className="text-base font-semibold tracking-tight">{enabled ? "AI is on" : "Allow AI"}</DialogTitle>
            <DialogDescription>
              {enabled ? "Text, voice, and photo questions in this app spend your credits." : "Turn on text, voice, and photo questions for this app."}
            </DialogDescription>
          </div>
        </DialogHeader>

        <ul className="grid gap-2">
          {JOBS.map(({ key, icon: Icon, label, detail }) => {
            const live = availability?.[key] ?? false
            return (
              <li key={key} className="flex items-center gap-3 rounded-2xl border border-border/60 px-3 py-2.5">
                <Icon className="size-4 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-xs text-muted-foreground">{detail}</span>
                </span>
                {availability && (
                  <span className={live ? "text-xs text-emerald-700" : "text-xs text-muted-foreground"}>{live ? "Ready" : "Not set up"}</span>
                )}
              </li>
            )
          })}
        </ul>

        <p className="text-xs leading-relaxed text-muted-foreground">
          You have {credits.toLocaleString()} credits. A published copy of this app spends the same balance, up to {AI_DAILY_CREDIT_CAP} AI credits a day.
          Dreamera keeps the provider keys. This app never sees them.
        </p>

        {error && (
          <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {availability && !ready ? (
          <p role="status" className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
            AI isn&apos;t set up on this Dreamera server yet.
          </p>
        ) : enabled ? (
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-1.5 text-sm text-emerald-700">
              <CheckCircle2Icon className="size-4" />
              Allowed for this app
            </p>
            <Button variant="ghost" className="rounded-full text-muted-foreground" disabled={pending} onClick={() => void setEnabled(false)}>
              {pending && <Loader2Icon className="animate-spin" />}
              Turn off
            </Button>
          </div>
        ) : (
          <Button className="h-10 rounded-full" disabled={pending || availability === null || !ready} onClick={() => void setEnabled(true)}>
            {pending && <Loader2Icon className="animate-spin" />}
            Allow AI
          </Button>
        )}
      </DialogContent>
    </Dialog>
  )
}
