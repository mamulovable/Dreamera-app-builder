"use client"

import * as React from "react"
import { KeyRoundIcon, Loader2Icon, Trash2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export type SecretRequest = { name: string; label: string }

type SecretRow = { name: string; label: string | null; updatedAt: string }

export function SecretsDialog({
  projectId,
  open,
  onOpenChange,
  request,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Prefill from the agent's request_secret tool. */
  request: SecretRequest | null
}) {
  const [secrets, setSecrets] = React.useState<SecretRow[]>([])
  const [loading, setLoading] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [ok, setOk] = React.useState<string | null>(null)
  const [name, setName] = React.useState("")
  const [label, setLabel] = React.useState("")
  const [value, setValue] = React.useState("")

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    const response = await fetch(`/api/projects/${projectId}/secrets`, { cache: "no-store" }).catch(() => null)
    const body = await response?.json().catch(() => null)
    setLoading(false)
    if (!response?.ok) {
      setError(body?.error ?? "Couldn't load API keys.")
      return
    }
    setSecrets(Array.isArray(body?.secrets) ? body.secrets : [])
  }, [projectId])

  React.useEffect(() => {
    if (!open) return
    void load()
  }, [open, load])

  React.useEffect(() => {
    if (!open || !request) return
    setName(request.name)
    setLabel(request.label)
    setValue("")
    setOk(null)
    setError(null)
  }, [open, request])

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    setOk(null)
    const response = await fetch(`/api/projects/${projectId}/secrets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, value, label: label || undefined }),
    }).catch(() => null)
    const body = await response?.json().catch(() => null)
    setPending(false)
    if (!response?.ok) {
      setError(body?.error ?? "Couldn't save that API key.")
      return
    }
    setValue("")
    setOk(`Saved ${body?.secret?.name ?? name}. The value is encrypted and never shown again.`)
    await load()
  }

  async function remove(secretName: string) {
    if (!window.confirm(`Remove ${secretName}? Apps that use it will stop working until you add it again.`)) return
    setPending(true)
    setError(null)
    setOk(null)
    const response = await fetch(`/api/projects/${projectId}/secrets`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: secretName }),
    }).catch(() => null)
    const body = await response?.json().catch(() => null)
    setPending(false)
    if (!response?.ok) {
      setError(body?.error ?? "Couldn't remove that API key.")
      return
    }
    if (name === secretName) setValue("")
    setOk(`Removed ${secretName}.`)
    await load()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 rounded-3xl p-6 sm:max-w-md">
        <DialogHeader className="flex-row items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-brand/15 to-brand-accent/15 text-brand">
            <KeyRoundIcon className="size-5" />
          </span>
          <div className="min-w-0 space-y-0.5">
            <DialogTitle className="text-base font-semibold tracking-tight">External API keys</DialogTitle>
            <DialogDescription>
              Keys stay encrypted on Dreamera. Your app calls them through Dreamera so the key never ships in the app.
            </DialogDescription>
          </div>
        </DialogHeader>

        {request ? (
          <p className="rounded-lg bg-brand/10 px-3 py-2 text-sm text-brand-dark">
            Dreamera needs <span className="font-semibold">{request.name}</span>
            {request.label ? ` (${request.label})` : ""}. Paste it below — never in the chat.
          </p>
        ) : null}

        <form className="space-y-3" onSubmit={(event) => void save(event)}>
          <div className="space-y-1.5">
            <Label htmlFor="secret-name">Key name</Label>
            <Input
              id="secret-name"
              value={name}
              onChange={(event) => setName(event.target.value.toUpperCase())}
              placeholder="OPENWEATHER_API_KEY"
              autoComplete="off"
              disabled={pending}
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="secret-label">Label (optional)</Label>
            <Input
              id="secret-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="OpenWeather"
              disabled={pending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="secret-value">Value</Label>
            <Input
              id="secret-value"
              type="password"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="Paste the API key"
              autoComplete="new-password"
              disabled={pending}
            />
          </div>
          <Button type="submit" className="h-10 w-full rounded-full" disabled={pending || !name.trim() || !value.trim()}>
            {pending ? <Loader2Icon className="animate-spin" /> : null}
            Save key
          </Button>
        </form>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Stored keys</h3>
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="size-3.5 animate-spin" /> Loading…
            </p>
          ) : secrets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No external API keys yet.</p>
          ) : (
            <ul className="divide-y divide-border/60 rounded-2xl border border-border/60">
              {secrets.map((secret) => (
                <li key={secret.name} className="flex items-center gap-2 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs font-medium">{secret.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {secret.label || "No label"} · updated {new Date(secret.updatedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0 rounded-full text-muted-foreground hover:text-destructive"
                    disabled={pending}
                    title={`Remove ${secret.name}`}
                    onClick={() => void remove(secret.name)}
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {error ? (
          <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {ok ? <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">{ok}</p> : null}
      </DialogContent>
    </Dialog>
  )
}
