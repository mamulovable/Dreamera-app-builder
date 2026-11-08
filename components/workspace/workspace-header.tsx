"use client"

import Link from "next/link"
import {
  ChevronDownIcon,
  CoinsIcon,
  DatabaseIcon,
  DownloadIcon,
  EyeIcon,
  GithubIcon,
  Loader2Icon,
  RocketIcon,
  Share2Icon,
  SmartphoneIcon,
} from "lucide-react"

import { isBackendConnected, type BackendStatus } from "@/lib/backend-protocol"
import { PLATFORM_LABELS, STATUS_STYLES, type ProjectPlatform, type ProjectStatus } from "@/lib/projects"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Logo } from "@/components/home/logo"

export function WorkspaceHeader({
  name,
  status,
  platform,
  credits,
  backend,
  readOnly,
  onOpenBackend,
  onShare,
  onDownload,
  onPushToGitHub,
  onPublish,
}: {
  name: string
  status: ProjectStatus
  platform: ProjectPlatform
  credits: number
  backend: BackendStatus
  /** Someone the project was shared with, who can look and download but not change it. */
  readOnly: boolean
  onOpenBackend: () => void
  onShare: () => void
  onDownload: () => void
  onPushToGitHub: () => void
  onPublish: () => void
}) {
  const statusStyle = STATUS_STYLES[status]

  return (
    <header className="relative z-20 grid h-14 shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center md:grid-cols-[1fr_auto_1fr] gap-3 border-b border-border/60 bg-white/80 px-3 backdrop-blur-xl sm:px-4">
      <Link href="/" aria-label="AppForge home" className="justify-self-start rounded-xl">
        <span className="hidden sm:inline">
          <Logo className="size-8 rounded-full" />
        </span>
        <span className="sm:hidden">
          <Logo showText={false} className="size-8 rounded-full" />
        </span>
      </Link>

      <div className="flex min-w-0 items-center justify-center gap-2">
        <h1 className="min-w-0 truncate text-sm md:max-w-[32vw] font-semibold tracking-tight sm:text-base" title={name}>
          {name}
        </h1>
        <span className="hidden items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground md:inline-flex">
          <span aria-hidden className={cn("size-1.5 rounded-full", statusStyle.dot)} />
          {statusStyle.label}
        </span>
        <span className="hidden items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground lg:inline-flex">
          <SmartphoneIcon className="size-3" />
          {PLATFORM_LABELS[platform]}
        </span>
        {readOnly && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-violet-500/10 px-2.5 py-1 text-xs font-medium text-violet-700">
            <EyeIcon className="size-3" />
            View only
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5 justify-self-end">
        <Link
          href="/pricing"
          title={`${credits} credits remaining`}
          className="hidden h-8 items-center gap-1.5 rounded-full bg-violet-500/10 px-3 text-xs font-medium text-violet-700 transition-colors hover:bg-violet-500/15 xl:inline-flex"
        >
          <CoinsIcon className="size-3.5" />
          {credits.toLocaleString()}
        </Link>

        {!readOnly && <BackendButton backend={backend} onClick={onOpenBackend} />}

        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="outline" className="h-8 rounded-full px-3" />}
          >
            <DownloadIcon />
            <span className="hidden sm:inline">Export</span>
            <ChevronDownIcon className="size-3.5 opacity-60" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52 rounded-2xl">
            {!readOnly && (
              <>
                <DropdownMenuItem className="rounded-xl py-2" onClick={onShare}>
                  <Share2Icon />
                  Share project
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem className="rounded-xl py-2" onClick={onDownload}>
              <DownloadIcon />
              Download as ZIP
            </DropdownMenuItem>
            {!readOnly && (
              <DropdownMenuItem className="rounded-xl py-2" onClick={onPushToGitHub}>
                <GithubIcon />
                Push to GitHub
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="rounded-xl py-2">
              <SmartphoneIcon />
              Open in Expo Snack
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {!readOnly && (
          <Button onClick={onPublish} className="h-8 rounded-full bg-linear-to-r from-indigo-500 via-violet-500 to-fuchsia-500 px-3.5 text-white shadow-md shadow-violet-500/30 hover:opacity-95">
            <RocketIcon />
            <span className="hidden sm:inline">Publish</span>
          </Button>
        )}
      </div>
    </header>
  )
}

function BackendButton({ backend, onClick }: { backend: BackendStatus; onClick: () => void }) {
  if (backend.state === "provisioning") {
    return (
      <Button variant="ghost" onClick={onClick} className="h-8 rounded-full bg-violet-500/10 px-3 text-violet-700 hover:bg-violet-500/15 hover:text-violet-700">
        <Loader2Icon className="animate-spin" />
        <span className="hidden lg:inline">Setting up backend…</span>
      </Button>
    )
  }
  if (backend.state === "failed" || (backend.state !== "disconnected" && !isBackendConnected(backend))) {
    return (
      <Button variant="ghost" onClick={onClick} className="h-8 rounded-full bg-amber-500/10 px-3 text-amber-700 hover:bg-amber-500/15 hover:text-amber-700">
        <DatabaseIcon />
        <span className="hidden lg:inline">Backend needs attention</span>
      </Button>
    )
  }
  if (isBackendConnected(backend)) {
    return (
      <Button
        variant="ghost"
        onClick={onClick}
        title="CloudHike Backend Connected"
        aria-label="CloudHike Backend Connected"
        className="h-8 rounded-full bg-emerald-500/10 px-3 text-emerald-700 hover:bg-emerald-500/15 hover:text-emerald-700"
      >
        <span aria-hidden className="size-1.5 rounded-full bg-emerald-500" />
        <span className="hidden xl:inline">CloudHike Backend Connected</span>
        <span className="hidden sm:inline xl:hidden">Connected</span>
      </Button>
    )
  }
  return (
    <Button variant="ghost" onClick={onClick} aria-label="Connect Backend" className="h-8 rounded-full px-3">
      <DatabaseIcon />
      <span className="hidden sm:inline">Connect Backend</span>
    </Button>
  )
}
