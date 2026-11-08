"use client"

import * as React from "react"
import {
  CheckCircle2Icon,
  CloudIcon,
  DatabaseIcon,
  ExternalLinkIcon,
  FolderIcon,
  KeyRoundIcon,
  Loader2Icon,
  MailIcon,
  ShieldCheckIcon,
  TimerIcon,
  TriangleAlertIcon,
} from "lucide-react"

import {
  BACKEND_SERVICE_LABELS,
  isBackendConnected,
  type BackendConnectResult,
  type BackendStatus,
} from "@/lib/backend-protocol"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

const FEATURES = [
  { icon: DatabaseIcon, label: "Database" },
  { icon: KeyRoundIcon, label: "Authentication" },
  { icon: FolderIcon, label: "File storage" },
  { icon: MailIcon, label: "Email" },
  { icon: TimerIcon, label: "Background jobs" },
]

const RESULT_MESSAGES: Partial<Record<BackendConnectResult, string>> = {
  denied: "You cancelled on CloudHike, so nothing was connected.",
  error: "We couldn't connect your CloudHike account. Please try again.",
}

export function BackendDialog({
  projectId,
  open,
  onOpenChange,
  backend,
  connectResult,
  onLink,
  onDisconnect,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  backend: BackendStatus
  connectResult: BackendConnectResult | null
  onLink: () => Promise<boolean>
  onDisconnect: () => Promise<boolean>
}) {
  const connected = isBackendConnected(backend)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 rounded-3xl p-6 sm:max-w-md">
        <DialogHeader className="flex-row items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-indigo-100 to-fuchsia-100 text-violet-600">
            <CloudIcon className="size-5" />
          </span>
          <div className="min-w-0 space-y-0.5">
            <DialogTitle className="text-base font-semibold tracking-tight">
              {connected ? "CloudHike Backend Connected" : "Connect a backend"}
            </DialogTitle>
            <DialogDescription>
              {connected ? "Your app's data lives in your own CloudHike account." : "Store your app's data in the cloud and sync it live."}
            </DialogDescription>
          </div>
        </DialogHeader>

        {connected ? (
          <ConnectedView projectId={projectId} backend={backend} onDisconnect={onDisconnect} onClose={() => onOpenChange(false)} />
        ) : (
          <ConnectView
            projectId={projectId}
            backend={backend}
            notice={connectResult ? (RESULT_MESSAGES[connectResult] ?? null) : null}
            onLink={onLink}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function ConnectView({
  projectId,
  backend,
  notice,
  onLink,
}: {
  projectId: string
  backend: BackendStatus
  notice: string | null
  onLink: () => Promise<boolean>
}) {
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const needsReconnect = backend.state !== "disconnected"
  const shownError = error ?? (needsReconnect ? backend.error : null) ?? notice

  async function link() {
    setPending(true)
    setError(null)
    if (!(await onLink())) setError("We couldn't connect this app. Please try again.")
    setPending(false)
  }

  return (
    <>
      <section className="rounded-2xl border border-border/60 p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">CloudHike</h3>
          <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-700">Default provider</span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Once you're connected, the AppForge agent deploys what your app needs and connects it for you.
        </p>
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {FEATURES.map(({ icon: Icon, label }) => (
            <li key={label} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">
              <Icon className="size-3" />
              {label}
            </li>
          ))}
        </ul>
      </section>

      <p className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
        <ShieldCheckIcon className="mt-px size-3.5 shrink-0 text-emerald-600" />
        You sign in on CloudHike, and AppForge never sees your password. Services run in your account and usage is billed to your workspace there.
      </p>

      {shownError && (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {shownError}
        </p>
      )}

      {!backend.available ? (
        <p role="status" className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          CloudHike isn't set up on this AppForge server yet.
        </p>
      ) : backend.accountConnected ? (
        <Button className="h-10 rounded-full" disabled={pending} onClick={link}>
          {pending && <Loader2Icon className="animate-spin" />}
          Use my connected CloudHike account
        </Button>
      ) : (
        <Button
          className="h-10 rounded-full"
          disabled={pending}
          onClick={() => {
            setPending(true)
            window.location.assign(`/api/projects/${projectId}/backend/connect`)
          }}
        >
          {pending && <Loader2Icon className="animate-spin" />}
          {needsReconnect ? "Connect CloudHike again" : "Connect CloudHike"}
        </Button>
      )}
    </>
  )
}

function ConnectedView({
  projectId,
  backend,
  onDisconnect,
  onClose,
}: {
  projectId: string
  backend: BackendStatus
  onDisconnect: () => Promise<boolean>
  onClose: () => void
}) {
  const [confirming, setConfirming] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function disconnect() {
    setPending(true)
    setError(null)
    if (await onDisconnect()) {
      setConfirming(false)
      onClose()
    } else {
      setError("We couldn't disconnect this app. Please try again.")
    }
    setPending(false)
  }

  return (
    <>
      <p className={cn(
        "flex items-center gap-2 rounded-2xl px-3 py-2.5 text-sm font-medium",
        backend.state === "failed" ? "bg-amber-500/10 text-amber-800" : "bg-emerald-500/10 text-emerald-800"
      )}>
        {backend.state === "provisioning" ? (
          <Loader2Icon className="size-4 shrink-0 animate-spin" />
        ) : backend.state === "failed" ? (
          <TriangleAlertIcon className="size-4 shrink-0" />
        ) : (
          <CheckCircle2Icon className="size-4 shrink-0" />
        )}
        {backend.state === "ready"
          ? "Your app is saving to CloudHike."
          : backend.state === "provisioning"
            ? "The agent is setting up your services…"
            : backend.state === "failed"
              ? "The last setup didn't finish. Ask the agent to try again."
              : "Connected. The agent deploys services once your app is built."}
      </p>

      {backend.error && <p role="alert" className="-mt-2 text-xs text-muted-foreground">{backend.error}</p>}

      {!backend.accountConnected && (
        <p className="-mt-2 text-xs leading-relaxed text-muted-foreground">
          Your app keeps running, but CloudHike no longer accepts AppForge's access, so nothing new can be deployed.{" "}
          <a href={`/api/projects/${projectId}/backend/connect`} className="font-medium text-violet-700 hover:underline">
            Connect CloudHike again
          </a>
        </p>
      )}

      {backend.services.length > 0 && (
        <ul className="divide-y divide-border/60 rounded-2xl border border-border/60">
          {backend.services.map((service) => (
            <li key={service.type} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              {BACKEND_SERVICE_LABELS[service.type]}
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground capitalize">
                <span aria-hidden className={cn("size-1.5 rounded-full", service.status === "ready" ? "bg-emerald-500" : service.status === "failed" ? "bg-red-500" : "bg-amber-500")} />
                {service.status}
              </span>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {confirming ? (
        <div className="rounded-2xl border border-border/60 p-3">
          <p className="text-sm font-medium">Disconnect this app from CloudHike?</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            The app goes back to saving on the device. Your data and services stay in CloudHike, and keep being billed until you delete them there.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" className="rounded-full" disabled={pending} onClick={() => setConfirming(false)}>
              Keep connected
            </Button>
            <Button variant="destructive" className="rounded-full" disabled={pending} onClick={disconnect}>
              {pending && <Loader2Icon className="animate-spin" />}
              Disconnect
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" className="rounded-full text-muted-foreground" disabled={backend.state === "provisioning"} onClick={() => setConfirming(true)}>
            Disconnect
          </Button>
          {backend.dashboardUrl && (
            <Button
              variant="outline"
              className="rounded-full"
              render={<a href={backend.dashboardUrl} target="_blank" rel="noreferrer" />}
              nativeButton={false}
            >
              Open in CloudHike
              <ExternalLinkIcon />
            </Button>
          )}
        </div>
      )}
    </>
  )
}
