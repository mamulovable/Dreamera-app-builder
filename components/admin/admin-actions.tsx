"use client"

import { useRouter } from "next/navigation"
import * as React from "react"
import { Loader2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

async function send(url: string, init: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.error ?? "Request failed.")
  return body
}

export function CreditAdjustForm({ userId }: { userId: number }) {
  const router = useRouter()
  const [amount, setAmount] = React.useState("100")
  const [note, setNote] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [ok, setOk] = React.useState<string | null>(null)

  async function submit(sign: 1 | -1) {
    setBusy(true)
    setError(null)
    setOk(null)
    const value = Number.parseInt(amount, 10)
    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter a positive whole number.")
      setBusy(false)
      return
    }
    try {
      await send("/api/admin/credits", {
        method: "POST",
        body: JSON.stringify({ userId, amount: sign * value, note }),
      })
      setOk(sign > 0 ? `Granted ${value} credits.` : `Deducted ${value} credits.`)
      setNote("")
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        void submit(1)
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="credit-amount">Credits</Label>
          <Input
            id="credit-amount"
            inputMode="numeric"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            disabled={busy}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="credit-note">Note</Label>
          <Input
            id="credit-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Optional reason"
            disabled={busy}
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy} className="rounded-full">
          {busy ? <Loader2Icon className="animate-spin" /> : null}
          Grant
        </Button>
        <Button type="button" variant="outline" disabled={busy} className="rounded-full" onClick={() => void submit(-1)}>
          Deduct
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {ok ? <p className="text-sm text-emerald-600">{ok}</p> : null}
    </form>
  )
}

export function SetPublicButton({ projectId, isPublic }: { projectId: string; isPublic: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function toggle() {
    setBusy(true)
    setError(null)
    try {
      await send(`/api/admin/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify({ isPublic: !isPublic }),
      })
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" className="rounded-full" disabled={busy} onClick={() => void toggle()}>
        {busy ? <Loader2Icon className="animate-spin" /> : null}
        {isPublic ? "Hide from home" : "Make public"}
      </Button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  )
}

export function DeleteProjectButton({ projectId, title }: { projectId: string; title: string }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function remove() {
    if (!window.confirm(`Delete “${title}”? This cannot be undone.`)) return
    setBusy(true)
    setError(null)
    try {
      await send(`/api/admin/projects/${projectId}`, { method: "DELETE" })
      router.push("/admin/projects")
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed.")
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="destructive" className="rounded-full" disabled={busy} onClick={() => void remove()}>
        {busy ? <Loader2Icon className="animate-spin" /> : null}
        Delete project
      </Button>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  )
}

export function FailBuildButton({ buildId }: { buildId: string }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function stop() {
    if (!window.confirm("Stop this build? Unfinished credits will be refunded.")) return
    setBusy(true)
    setError(null)
    try {
      await send(`/api/admin/builds/${buildId}/fail`, { method: "POST" })
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-1">
      <Button type="button" variant="outline" size="sm" className="rounded-full" disabled={busy} onClick={() => void stop()}>
        {busy ? <Loader2Icon className="animate-spin" /> : null}
        Stop
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}

export function HidePublicButton({ projectId }: { projectId: string }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function hide() {
    setBusy(true)
    setError(null)
    try {
      await send(`/api/admin/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify({ isPublic: false }),
      })
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-1">
      <Button type="button" variant="outline" size="sm" className="rounded-full" disabled={busy} onClick={() => void hide()}>
        {busy ? <Loader2Icon className="animate-spin" /> : null}
        Hide
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
