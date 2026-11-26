"use client"

import * as React from "react"
import Link from "next/link"
import {
  CheckIcon,
  ChevronDownIcon,
  CoinsIcon,
  DatabaseIcon,
  DownloadIcon,
  EyeIcon,
  GithubIcon,
  GlobeIcon,
  Loader2Icon,
  PencilIcon,
  RocketIcon,
  Share2Icon,
  SmartphoneIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react"

import { isBackendConnected, type BackendStatus } from "@/lib/backend-protocol"
import {
  isMobilePlatform,
  isWebsitePlatform,
  MAX_PROJECT_NAME_LENGTH,
  PLATFORM_LABELS,
  STATUS_STYLES,
  type ProjectPlatform,
  type ProjectStatus,
} from "@/lib/projects"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { Logo } from "@/components/home/logo"
import { ThemeToggle } from "@/components/theme-toggle"

export function WorkspaceHeader({
  projectId,
  name,
  status,
  platform,
  credits,
  backend,
  aiEnabled,
  showAi,
  readOnly,
  busy,
  onRenamed,
  onOpenBackend,
  onOpenAi,
  onShare,
  onDownload,
  onPushToGitHub,
  onPublish,
}: {
  projectId: string
  name: string
  status: ProjectStatus
  platform: ProjectPlatform
  credits: number
  backend: BackendStatus
  aiEnabled: boolean
  /** Website v2 has no AI functions, so the button stays hidden. */
  showAi: boolean
  /** Someone the project was shared with, who can look and download but not change it. */
  readOnly: boolean
  /** True while the agent is working — renaming waits until it's done. */
  busy?: boolean
  onRenamed?: (name: string) => void
  onOpenBackend: () => void
  onOpenAi: () => void
  onShare: () => void
  onDownload: () => void
  onPushToGitHub: () => void
  onPublish: () => void
}) {
  const statusStyle = STATUS_STYLES[status]
  const canRename = !readOnly && !busy && status !== "building"

  return (
    <header className="relative z-20 flex h-12 shrink-0 items-center gap-2 border-b border-border/60 bg-background/80 px-3 backdrop-blur-xl sm:gap-3 sm:px-4">
      <Link href="/" aria-label="Dreamera home" className="shrink-0 rounded-xl">
        <Logo showText={false} className="size-8 rounded-full" />
      </Link>

      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        <EditableAppName
          projectId={projectId}
          name={name}
          canEdit={canRename}
          onRenamed={onRenamed}
        />
        <div className="hidden h-4 w-px shrink-0 bg-border/70 sm:block" aria-hidden />
        <div className="hidden min-w-0 items-center gap-2 text-[11px] text-muted-foreground sm:flex">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cn("size-1.5 rounded-full", statusStyle.dot)} />
            {statusStyle.label}
          </span>
          <span aria-hidden className="text-border">·</span>
          <span className="inline-flex items-center gap-1 truncate">
            {isWebsitePlatform(platform) ? <GlobeIcon className="size-3 shrink-0" /> : <SmartphoneIcon className="size-3 shrink-0" />}
            {PLATFORM_LABELS[platform]}
          </span>
          {readOnly && (
            <>
              <span aria-hidden className="text-border">·</span>
              <span className="inline-flex items-center gap-1 text-brand-dark">
                <EyeIcon className="size-3" />
                View only
              </span>
            </>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
        <ThemeToggle className="size-8" />
        <Link
          href="/pricing"
          title={`${credits} credits remaining`}
          className="hidden h-8 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground xl:inline-flex"
        >
          <CoinsIcon className="size-3.5" />
          {credits.toLocaleString()}
        </Link>

        {!readOnly && showAi && <AiButton enabled={aiEnabled} onClick={onOpenAi} />}
        {!readOnly && <BackendButton backend={backend} onClick={onOpenBackend} />}

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                className="h-8 rounded-full px-2.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              />
            }
          >
            <DownloadIcon className="size-4" />
            <span className="hidden sm:inline">Export</span>
            <ChevronDownIcon className="size-3 opacity-50" />
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
            {isMobilePlatform(platform) && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="rounded-xl py-2">
                  <SmartphoneIcon />
                  Open in Expo Snack
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {!readOnly && (
          <Button
            onClick={onPublish}
            className="ml-0.5 h-8 rounded-full bg-brand px-3 text-white shadow-md shadow-brand/25 hover:opacity-95"
          >
            <RocketIcon className="size-3.5" />
            <span className="hidden sm:inline">Publish</span>
          </Button>
        )}
      </div>
    </header>
  )
}

function EditableAppName({
  projectId,
  name,
  canEdit,
  onRenamed,
}: {
  projectId: string
  name: string
  canEdit: boolean
  onRenamed?: (name: string) => void
}) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(name)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (!editing) setDraft(name)
  }, [name, editing])

  React.useEffect(() => {
    if (!editing) return
    const el = inputRef.current
    if (!el) return
    el.focus()
    el.select()
  }, [editing])

  function startEditing() {
    if (!canEdit || saving) return
    setError(null)
    setDraft(name)
    setEditing(true)
  }

  function cancel() {
    setEditing(false)
    setDraft(name)
    setError(null)
  }

  async function save() {
    const next = draft.trim().replace(/\s+/g, " ")
    if (!next) {
      setError("Give your project a name.")
      return
    }
    if (next.length > MAX_PROJECT_NAME_LENGTH) {
      setError(`Keep the name under ${MAX_PROJECT_NAME_LENGTH} characters.`)
      return
    }
    if (next === name) {
      setEditing(false)
      setError(null)
      return
    }

    setSaving(true)
    setError(null)
    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: next }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || "Couldn't rename this project.")
      onRenamed?.(typeof data?.name === "string" ? data.name : next)
      setEditing(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't rename this project.")
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div className="relative min-w-0 max-w-[min(55vw,18rem)]">
        <div className="flex items-center gap-1">
          <input
            ref={inputRef}
            value={draft}
            maxLength={MAX_PROJECT_NAME_LENGTH}
            disabled={saving}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                void save()
              } else if (e.key === "Escape") {
                e.preventDefault()
                cancel()
              }
            }}
            aria-label="App name"
            className="h-8 min-w-0 flex-1 rounded-lg border border-brand/30 bg-background px-2.5 text-sm font-semibold tracking-tight outline-none focus:ring-2 focus:ring-brand/20"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={saving}
            aria-label="Save name"
            onClick={() => void save()}
            className="size-7 shrink-0 rounded-full text-brand-dark hover:bg-brand/10"
          >
            {saving ? <Spinner className="size-3.5" /> : <CheckIcon className="size-3.5" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={saving}
            aria-label="Cancel rename"
            onClick={cancel}
            className="size-7 shrink-0 rounded-full text-muted-foreground hover:bg-muted"
          >
            <XIcon className="size-3.5" />
          </Button>
        </div>
        {error && (
          <p role="alert" className="absolute left-0 top-full z-10 mt-1 whitespace-nowrap rounded-md bg-popover px-1.5 text-[11px] text-destructive shadow-sm">
            {error}
          </p>
        )}
      </div>
    )
  }

  if (!canEdit) {
    return (
      <h1 className="min-w-0 max-w-[min(50vw,16rem)] truncate text-sm font-semibold tracking-tight sm:max-w-[18rem] sm:text-[15px]" title={name}>
        {name}
      </h1>
    )
  }

  return (
    <button
      type="button"
      onClick={startEditing}
      title="Click to rename"
      className="group inline-flex min-w-0 max-w-[min(50vw,16rem)] items-center gap-1.5 rounded-lg px-1.5 py-0.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30 sm:max-w-[18rem]"
    >
      <h1 className="min-w-0 truncate text-sm font-semibold tracking-tight sm:text-[15px]">{name}</h1>
      <PencilIcon className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
    </button>
  )
}

function AiButton({ enabled, onClick }: { enabled: boolean; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      title={enabled ? "AI is on" : "Allow AI"}
      aria-label={enabled ? "AI is on" : "Allow AI"}
      className={cn(
        "h-8 rounded-full px-2.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
        enabled && "text-emerald-700 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-400"
      )}
    >
      <SparklesIcon className="size-3.5" />
      <span className="hidden lg:inline">{enabled ? "AI on" : "AI"}</span>
    </Button>
  )
}

function BackendButton({ backend, onClick }: { backend: BackendStatus; onClick: () => void }) {
  if (backend.state === "provisioning") {
    return (
      <Button
        variant="ghost"
        onClick={onClick}
        title="Setting up backend…"
        aria-label="Setting up backend"
        className="h-8 rounded-full px-2.5 text-brand-dark hover:bg-muted/60"
      >
        <Loader2Icon className="size-3.5 animate-spin" />
        <span className="hidden lg:inline">Backend…</span>
      </Button>
    )
  }
  if (backend.state === "failed" || (backend.state !== "disconnected" && !isBackendConnected(backend))) {
    return (
      <Button
        variant="ghost"
        onClick={onClick}
        title="Backend needs attention"
        aria-label="Backend needs attention"
        className="h-8 rounded-full px-2.5 text-amber-700 hover:bg-amber-500/10 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-400"
      >
        <DatabaseIcon className="size-3.5" />
        <span className="hidden lg:inline">Backend</span>
      </Button>
    )
  }
  if (isBackendConnected(backend)) {
    return (
      <Button
        variant="ghost"
        onClick={onClick}
        title="CloudHike backend connected"
        aria-label="CloudHike backend connected"
        className="h-8 rounded-full px-2.5 text-emerald-700 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-400"
      >
        <span aria-hidden className="size-1.5 rounded-full bg-emerald-500" />
        <span className="hidden lg:inline">Backend</span>
      </Button>
    )
  }
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      title="Connect backend"
      aria-label="Connect Backend"
      className="h-8 rounded-full px-2.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
    >
      <DatabaseIcon className="size-3.5" />
      <span className="hidden lg:inline">Backend</span>
    </Button>
  )
}
