"use client"

import * as React from "react"
import { QRCodeSVG } from "qrcode.react"
import { AlertCircleIcon, CheckIcon, CopyIcon, QrCodeIcon, RotateCwIcon } from "lucide-react"

import { useExpoSnack, type ExpoDevice, type ExpoSnackStatus } from "@/hooks/use-expo-snack"
import type { AppPlan, ProjectScreen } from "@/lib/agent-protocol"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"

export function ExpoQrPopover({ plan, screens }: { plan: AppPlan | null; screens: ProjectScreen[] }) {
  const [open, setOpen] = React.useState(false)
  // Starts on first use, then stays online so a connected phone keeps getting changes.
  const [started, setStarted] = React.useState(false)
  const { status, hasProject, retry } = useExpoSnack(plan, screens, started)
  const connected = status.state === "ready" && status.devices.length > 0

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setStarted(true)
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            aria-label="Scan QR code to test on your device"
            className="relative rounded-full border-violet-200 text-violet-700 hover:bg-violet-500/10 hover:text-violet-700 aria-expanded:bg-violet-500/10"
          />
        }
      >
        <QrCodeIcon />
        <span className="hidden @[26rem]:inline">Scan QR Code</span>
        {connected && (
          <span aria-hidden className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
        )}
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-80 gap-3 rounded-2xl p-4 shadow-[0_16px_48px_-16px_rgba(76,29,149,0.35)]">
        <div className="space-y-0.5">
          <PopoverTitle className="text-sm font-semibold">Test on your device</PopoverTitle>
          <PopoverDescription className="text-xs">
            Scan with your iPhone's Camera, or from inside Expo Go on Android. Keep this tab open while you test.
          </PopoverDescription>
        </div>
        <PopoverBody status={status} hasProject={hasProject} retry={retry} />
      </PopoverContent>
    </Popover>
  )
}

function PopoverBody({ status, hasProject, retry }: { status: ExpoSnackStatus; hasProject: boolean; retry: () => void }) {
  if (!hasProject) {
    return <Notice icon={<Spinner className="size-4 text-violet-600" />} text="Your QR code appears once the agent has built your first screen." />
  }
  if (status.state === "error") {
    return (
      <Notice icon={<AlertCircleIcon className="size-4 text-destructive" />} text={status.message}>
        <Button variant="outline" size="sm" className="rounded-full" onClick={retry}>
          <RotateCwIcon />
          Try again
        </Button>
      </Notice>
    )
  }
  if (status.state !== "ready") {
    return (
      <div role="status" aria-label="Getting your QR code" className="flex justify-center">
        <Skeleton className="size-[216px] rounded-2xl" />
      </div>
    )
  }

  return (
    <>
      <div className="flex justify-center">
        <div className="rounded-2xl border border-border/60 bg-white p-3">
          <QRCodeSVG value={status.url} size={192} level="M" title="QR code that opens this app in Expo Go" />
        </div>
      </div>
      <ConnectionStatus devices={status.devices} />
      {status.problem && <p className="text-xs break-words text-destructive">{status.problem}</p>}
      <p className="text-xs leading-relaxed text-muted-foreground">
        Needs Expo Go for SDK 54. If it says the app is incompatible, your Expo Go is on a newer SDK.
      </p>
      <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-3">
        <a
          href="https://expo.dev/go"
          target="_blank"
          rel="noreferrer"
          className="text-xs font-medium text-violet-700 hover:underline"
        >
          Get Expo Go
        </a>
        <CopyLinkButton url={status.url} />
      </div>
    </>
  )
}

function Notice({ icon, text, children }: { icon: React.ReactNode; text: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl bg-muted/50 px-4 py-6 text-center">
      {icon}
      <p className="text-xs leading-relaxed text-muted-foreground">{text}</p>
      {children}
    </div>
  )
}

function ConnectionStatus({ devices }: { devices: ExpoDevice[] }) {
  if (devices.length === 0) {
    return <StatusRow tone="waiting">Waiting for a device to connect</StatusRow>
  }
  return (
    <ul className="space-y-1.5" aria-live="polite">
      {devices.map((device) => (
        <li key={device.id}>
          <StatusRow tone={device.error ? "error" : "connected"}>
            <span className="font-medium text-foreground">{device.name || device.platform}</span>
            {" · "}
            {device.error ? "Hit a problem" : "Live"}
            {device.error && <span className="mt-0.5 line-clamp-3 block font-mono text-[11px] break-words">{device.error}</span>}
          </StatusRow>
        </li>
      ))}
    </ul>
  )
}

const STATUS_DOT = {
  waiting: "animate-pulse bg-neutral-400",
  connected: "bg-emerald-500",
  error: "bg-destructive",
}

function StatusRow({ tone, children }: { tone: keyof typeof STATUS_DOT; children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-xl bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
      <span aria-hidden className={cn("mt-1 size-1.5 shrink-0 rounded-full", STATUS_DOT[tone])} />
      <span className="min-w-0">{children}</span>
    </p>
  )
}

export function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = React.useState(false)

  React.useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  return (
    <Button
      variant="ghost"
      size="sm"
      className="rounded-full text-xs text-muted-foreground"
      onClick={() => void navigator.clipboard.writeText(url).then(() => setCopied(true))}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {copied ? "Copied" : "Copy link"}
    </Button>
  )
}
