"use client"

import * as React from "react"
import { CheckIcon, CopyIcon, GlobeIcon, Loader2Icon, Share2Icon, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"

type Person = { userId: number; name: string | null; email: string }

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function ShareDialog({
  projectId,
  open,
  onOpenChange,
  onPublicChange,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onPublicChange?: (isPublic: boolean) => void
}) {
  const [isPublic, setIsPublic] = React.useState<boolean | null>(null)
  const [savingPublic, setSavingPublic] = React.useState(false)
  const [people, setPeople] = React.useState<Person[] | null>(null)
  const [email, setEmail] = React.useState("")
  const [adding, setAdding] = React.useState(false)
  const [removing, setRemoving] = React.useState<number | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [added, setAdded] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)

  const request = React.useCallback(
    async (init?: RequestInit) => {
      const response = await fetch(`/api/projects/${projectId}/shares`, {
        ...init,
        headers: init?.body ? { "Content-Type": "application/json" } : undefined,
      }).catch(() => null)
      if (!response) return "Couldn't reach the server. Check your connection and try again."
      const body = await response.json().catch(() => null)
      if (!response.ok) return (body?.error as string | undefined) ?? "Something went wrong. Please try again."
      setPeople(body.people)
      if (typeof body.isPublic === "boolean") setIsPublic(body.isPublic)
      return null
    },
    [projectId]
  )

  React.useEffect(() => {
    if (!open) return
    setEmail("")
    setError(null)
    setAdded(null)
    setCopied(false)
    setPeople(null)
    setIsPublic(null)
    void request().then(setError)
  }, [open, request])

  async function add(event: React.FormEvent) {
    event.preventDefault()
    const address = email.trim().toLowerCase()
    setAdded(null)
    if (!EMAIL_PATTERN.test(address)) return setError("Enter a valid email address.")
    setAdding(true)
    setError(null)
    const problem = await request({ method: "POST", body: JSON.stringify({ email: address }) })
    setAdding(false)
    if (problem) return setError(problem)
    setEmail("")
    setAdded(address)
  }

  async function remove(person: Person) {
    setRemoving(person.userId)
    setError(null)
    setAdded(null)
    setError(await request({ method: "DELETE", body: JSON.stringify({ userId: person.userId }) }))
    setRemoving(null)
  }

  async function changePublic(next: boolean) {
    setSavingPublic(true)
    setError(null)
    setAdded(null)
    const response = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPublic: next }),
    }).catch(() => null)
    setSavingPublic(false)
    if (response?.ok) {
      setIsPublic(next)
      onPublicChange?.(next)
      return
    }
    const body = await response?.json().catch(() => null)
    setError((body?.error as string | undefined) ?? "We couldn't change this. Please try again.")
  }

  async function copyLink() {
    await navigator.clipboard.writeText(`${window.location.origin}/workspace/${projectId}`).then(
      () => setCopied(true),
      () => setError("Couldn't copy the link. Copy it from your browser's address bar instead.")
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 rounded-3xl p-6 sm:max-w-md">
        <DialogHeader className="flex-row items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-indigo-100 to-fuchsia-100 text-violet-600">
            <Share2Icon className="size-5" />
          </span>
          <div className="min-w-0 space-y-0.5">
            <DialogTitle className="text-base font-semibold tracking-tight">Share project</DialogTitle>
            <DialogDescription>People you add can view this project and download it, but can't change it.</DialogDescription>
          </div>
        </DialogHeader>

        <form onSubmit={add} noValidate className="flex items-start gap-2">
          <label htmlFor="share-email" className="sr-only">
            Email address
          </label>
          <Input
            id="share-email"
            type="email"
            autoComplete="off"
            placeholder="name@example.com"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
              setError(null)
            }}
            aria-invalid={Boolean(error)}
            className="h-10 flex-1 rounded-full px-4"
          />
          <Button type="submit" className="h-10 rounded-full px-4" disabled={adding || !email.trim()}>
            {adding && <Loader2Icon className="animate-spin" />}
            Share
          </Button>
        </form>

        {error && (
          <p role="alert" className="-mt-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        {added && !error && (
          <p role="status" className="-mt-2 flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800">
            <CheckIcon className="size-4 shrink-0" />
            <span className="min-w-0 truncate">Shared with {added}. It's now under Shared with you on their home page.</span>
          </p>
        )}

        <div className="flex items-start gap-3 rounded-2xl border border-border/60 p-3">
          <GlobeIcon className="mt-0.5 size-4 shrink-0 text-violet-600" />
          <div className="min-w-0 flex-1">
            <label htmlFor="project-public" className="text-sm font-medium">
              Show on the AppForge home page
            </label>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              Anyone can try the app on sample data and read its code, and they'll see your name. They can't see your chat or real
              data, or change anything.
            </p>
          </div>
          <Switch
            id="project-public"
            checked={isPublic ?? false}
            disabled={isPublic === null || savingPublic}
            onCheckedChange={(next) => void changePublic(next)}
          />
        </div>

        <section aria-label="People with access">
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">People with access</h3>
          {people === null ? (
            !error && (
              <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" />
                Loading…
              </p>
            )
          ) : people.length === 0 ? (
            <p className="rounded-2xl bg-muted/60 px-3 py-2.5 text-sm text-muted-foreground">Only you, for now.</p>
          ) : (
            <ul className="max-h-48 divide-y divide-border/60 overflow-y-auto rounded-2xl border border-border/60">
              {people.map((person) => (
                <li key={person.userId} className="flex items-center justify-between gap-3 py-2 pr-2 pl-3">
                  <span className="min-w-0">
                    {person.name && <span className="block truncate text-sm font-medium">{person.name}</span>}
                    <span className="block truncate text-xs text-muted-foreground">{person.email}</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Stop sharing with ${person.email}`}
                    title="Remove access"
                    disabled={removing !== null}
                    onClick={() => void remove(person)}
                    className="shrink-0 rounded-full text-muted-foreground"
                  >
                    {removing === person.userId ? <Loader2Icon className="animate-spin" /> : <XIcon />}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Button variant="outline" className="h-10 rounded-full" onClick={() => void copyLink()}>
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? "Link copied" : "Copy project link"}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
