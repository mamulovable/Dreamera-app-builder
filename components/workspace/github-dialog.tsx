"use client"

import * as React from "react"
import {
  CheckCircle2Icon,
  ExternalLinkIcon,
  GitBranchIcon,
  GithubIcon,
  GitPullRequestIcon,
  Loader2Icon,
  LockIcon,
  RotateCwIcon,
  SearchIcon,
  ShieldCheckIcon,
} from "lucide-react"

import type {
  GitHubConnectResult,
  GitHubErrorCode,
  GitHubLinkedRepository,
  GitHubPushEvent,
  GitHubPushResult,
  GitHubRepositoryOption,
  GitHubStatus,
} from "@/lib/github-protocol"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"

const CONNECT_MESSAGES: Partial<Record<GitHubConnectResult, string>> = {
  denied: "You cancelled on GitHub, so nothing was connected.",
  error: "We couldn't connect your GitHub account. Please try again.",
}

type View =
  | { name: "loading" }
  | { name: "picker"; notice?: string }
  | { name: "confirm"; notice?: string }
  | { name: "pushing"; label: string; percent: number }
  | { name: "done"; result: GitHubPushResult }
  | { name: "failed"; message: string }

/** Reads the push's progress to its end. Returns whether it finished, rather than the connection dropping. */
async function readPush(body: NonNullable<Response["body"]>, onEvent: (event: GitHubPushEvent) => void) {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ""
  let finished = false
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return finished
    buffer += value
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      if (!line.trim()) continue
      const event = JSON.parse(line) as GitHubPushEvent
      if (event.type !== "progress") finished = true
      onEvent(event)
    }
  }
}

export function GitHubDialog({
  projectId,
  projectName,
  defaultRepoName,
  open,
  onOpenChange,
  connectResult,
  beforeExport,
}: {
  projectId: string
  projectName: string
  defaultRepoName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** How the browser's trip to GitHub went, when it has just come back. */
  connectResult: GitHubConnectResult | null
  /** Saves edits still on their way, so the push has them. */
  beforeExport: () => Promise<boolean>
}) {
  const [status, setStatus] = React.useState<GitHubStatus | null>(null)
  const [view, setView] = React.useState<View>({ name: "loading" })

  const push = React.useCallback(async () => {
    setView({ name: "pushing", label: "Saving your latest edits…", percent: 1 })
    if (!(await beforeExport())) {
      return setView({ name: "failed", message: "We couldn't save your latest edits, so we stopped the push. Please try again." })
    }
    const response = await fetch(`/api/projects/${projectId}/github`, { method: "POST" }).catch(() => null)
    if (!response?.ok || !response.body) {
      const body = await response?.json().catch(() => null)
      return setView({ name: "failed", message: body?.error ?? "Couldn't reach the server. Check your connection and try again." })
    }

    let failure: { message: string; code?: GitHubErrorCode } | null = null
    const finished = await readPush(response.body, (event) => {
      if (event.type === "progress") setView({ name: "pushing", label: event.label, percent: event.percent })
      else if (event.type === "done") {
        setView({ name: "done", result: event.result })
        setStatus((current) =>
          current?.repository && event.result.outcome === "pushed"
            ? { ...current, repository: { ...current.repository, lastBranch: event.result.branch, lastPushedAt: new Date().toISOString() } }
            : current
        )
      } else failure = { message: event.message, code: event.code }
    }).catch(() => false)

    if (!finished) {
      return setView({ name: "failed", message: "We lost the connection during the push. Check your repository on GitHub before trying again." })
    }
    if (failure) {
      const { message, code } = failure as { message: string; code?: GitHubErrorCode }
      if (code === "reauth") setStatus((current) => current && { ...current, account: null })
      if (code === "repository") {
        setStatus((current) => current && { ...current, repository: null })
        return setView({ name: "picker", notice: message })
      }
      setView(code === "reauth" ? { name: "picker", notice: message } : { name: "failed", message })
    }
  }, [beforeExport, projectId])

  const pushRef = React.useRef(push)
  React.useEffect(() => {
    pushRef.current = push
  })

  // Opening this is the request: a project that's been pushed before goes straight to a new branch.
  const load = React.useCallback(
    async (allowAutoPush: boolean) => {
      setView({ name: "loading" })
      const response = await fetch(`/api/projects/${projectId}/github`).catch(() => null)
      const body = await response?.json().catch(() => null)
      if (!response?.ok) {
        return setView({ name: "failed", message: body?.error ?? "We couldn't check your GitHub connection. Please try again." })
      }
      const next = body as GitHubStatus
      setStatus(next)
      if (next.account && next.repository?.lastPushedAt && allowAutoPush) return void pushRef.current()
      setView(next.repository ? { name: "confirm" } : { name: "picker" })
    },
    [projectId]
  )

  React.useEffect(() => {
    // Coming back from GitHub only finishes connecting. Pushing waits for the person to ask.
    if (open) void load(connectResult === null)
  }, [connectResult, load, open])

  const pushing = view.name === "pushing"
  const showConnect = status && status.available && !status.account && view.name !== "failed" && view.name !== "loading"
  const account = status?.account

  async function disconnect() {
    const response = await fetch("/api/github/connection", { method: "DELETE" }).catch(() => null)
    if (!response?.ok) return setView({ name: "failed", message: "We couldn't disconnect GitHub. Please try again." })
    setStatus((current) => current && { ...current, account: null })
    setView({ name: "picker" })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Closing during a push would hide how it ended.
        if (!pushing || next) onOpenChange(next)
      }}
    >
      <DialogContent className="gap-5 rounded-3xl p-6 sm:max-w-md" showCloseButton={!pushing}>
        <DialogHeader className="flex-row items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-indigo-100 to-fuchsia-100 text-violet-600">
            <GithubIcon className="size-5" />
          </span>
          <div className="min-w-0 space-y-0.5">
            <DialogTitle className="text-base font-semibold tracking-tight">Push to GitHub</DialogTitle>
            <DialogDescription>
              {account ? (
                <>
                  Connected as <span className="font-medium text-foreground">{account.login}</span>
                  {!pushing && (
                    <>
                      {" · "}
                      <button type="button" onClick={() => void disconnect()} className="hover:text-foreground hover:underline">
                        Disconnect
                      </button>
                    </>
                  )}
                </>
              ) : (
                "Keep your project's code in your own repository."
              )}
            </DialogDescription>
          </div>
        </DialogHeader>

        {view.name === "loading" ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            Checking your GitHub connection…
          </p>
        ) : status && !status.available ? (
          <p role="status" className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
            GitHub isn't set up on this AppForge server yet.
          </p>
        ) : showConnect ? (
          <ConnectView
            projectId={projectId}
            notice={("notice" in view ? view.notice : null) ?? (connectResult ? (CONNECT_MESSAGES[connectResult] ?? null) : null)}
          />
        ) : view.name === "picker" ? (
          <RepositoryPicker
            projectId={projectId}
            defaultRepoName={defaultRepoName}
            notice={view.notice}
            onChosen={(next) => {
              setStatus(next)
              setView({ name: "confirm" })
            }}
            onNeedsConnection={(message) => {
              setStatus((current) => current && { ...current, account: null })
              setView({ name: "picker", notice: message })
            }}
          />
        ) : view.name === "confirm" && status?.repository ? (
          <ConfirmView
            repository={status.repository}
            projectName={projectName}
            notice={view.notice}
            onPush={() => void push()}
            onChange={() => setView({ name: "picker" })}
          />
        ) : view.name === "pushing" ? (
          <div role="status" className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Loader2Icon className="size-4 shrink-0 animate-spin text-violet-600" />
              <span className="min-w-0 truncate">{view.label}</span>
            </p>
            <Progress value={view.percent} aria-label="Push progress" />
            <p className="text-xs text-muted-foreground">This usually takes a few seconds. Keep this window open.</p>
          </div>
        ) : view.name === "done" ? (
          <DoneView result={view.result} onClose={() => onOpenChange(false)} onChange={() => setView({ name: "picker" })} />
        ) : view.name === "failed" ? (
          <>
            <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {view.message}
            </p>
            <Button className="h-10 rounded-full" onClick={() => void load(false)}>
              <RotateCwIcon />
              Try again
            </Button>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function ConnectView({ projectId, notice }: { projectId: string; notice: string | null }) {
  const [pending, setPending] = React.useState(false)
  return (
    <>
      <p className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
        <ShieldCheckIcon className="mt-px size-3.5 shrink-0 text-emerald-600" />
        You sign in on GitHub, and AppForge never sees your password. GitHub asks for access to your repositories, which AppForge only uses to list them and to push when you ask.
      </p>
      {notice && (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {notice}
        </p>
      )}
      <Button
        className="h-10 rounded-full"
        disabled={pending}
        onClick={() => {
          setPending(true)
          window.location.assign(`/api/projects/${projectId}/github/connect`)
        }}
      >
        {pending ? <Loader2Icon className="animate-spin" /> : <GithubIcon />}
        Connect GitHub
      </Button>
    </>
  )
}

function RepositoryPicker({
  projectId,
  defaultRepoName,
  notice,
  onChosen,
  onNeedsConnection,
}: {
  projectId: string
  defaultRepoName: string
  notice?: string
  onChosen: (status: GitHubStatus) => void
  onNeedsConnection: (message: string) => void
}) {
  const [mode, setMode] = React.useState<"create" | "existing">("create")
  const [name, setName] = React.useState(defaultRepoName)
  const [isPrivate, setIsPrivate] = React.useState(true)
  const [repositories, setRepositories] = React.useState<GitHubRepositoryOption[] | null>(null)
  const [search, setSearch] = React.useState("")
  const [pending, setPending] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(notice ?? null)

  React.useEffect(() => {
    if (mode !== "existing" || repositories) return
    let active = true
    void (async () => {
      const response = await fetch("/api/github/repos").catch(() => null)
      const body = await response?.json().catch(() => null)
      if (!active) return
      if (body?.code === "reauth") return onNeedsConnection(body.error)
      if (!response?.ok) return setError(body?.error ?? "We couldn't load your repositories. Please try again.")
      setRepositories(body.repositories)
    })()
    return () => {
      active = false
    }
  }, [mode, onNeedsConnection, repositories])

  async function choose(payload: object, key: string) {
    setPending(key)
    setError(null)
    const response = await fetch(`/api/projects/${projectId}/github`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null)
    const body = await response?.json().catch(() => null)
    setPending(null)
    if (body?.code === "reauth") return onNeedsConnection(body.error)
    if (!response?.ok) return setError(body?.error ?? "Couldn't reach the server. Check your connection and try again.")
    onChosen(body as GitHubStatus)
  }

  const matches = (repositories ?? []).filter((repo) => repo.fullName.toLowerCase().includes(search.trim().toLowerCase()))

  return (
    <>
      <div role="tablist" aria-label="Repository" className="grid grid-cols-2 gap-1 rounded-full bg-muted p-1">
        {(
          [
            ["create", "New repository"],
            ["existing", "Existing repository"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            onClick={() => {
              setMode(id)
              setError(null)
            }}
            className={cn(
              "rounded-full py-1.5 text-sm font-medium transition-colors",
              mode === id ? "bg-white shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {mode === "create" ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void choose({ create: { name, private: isPrivate } }, "create")
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor="github-repo-name" className="text-sm font-medium">
              Repository name
            </label>
            <Input id="github-repo-name" value={name} maxLength={100} onChange={(event) => setName(event.target.value)} className="h-10 rounded-full px-4" />
          </div>
          <label className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 px-3 py-2.5">
            <span className="min-w-0">
              <span className="block text-sm font-medium">Private</span>
              <span className="block text-xs text-muted-foreground">Only you and people you invite on GitHub can see it.</span>
            </span>
            <Switch checked={isPrivate} onCheckedChange={setIsPrivate} />
          </label>
          <Button type="submit" className="h-10 w-full rounded-full" disabled={pending !== null || !name.trim()}>
            {pending === "create" && <Loader2Icon className="animate-spin" />}
            {pending === "create" ? "Creating repository…" : "Create repository"}
          </Button>
        </form>
      ) : repositories === null ? (
        !error && (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            Loading your repositories…
          </p>
        )
      ) : repositories.length === 0 ? (
        <p className="rounded-2xl bg-muted/60 px-3 py-2.5 text-sm text-muted-foreground">No repositories you can push to yet. Create a new one instead.</p>
      ) : (
        <div className="space-y-2">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <label htmlFor="github-repo-search" className="sr-only">
              Search repositories
            </label>
            <Input
              id="github-repo-search"
              placeholder="Search repositories"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="h-10 rounded-full pr-4 pl-9"
            />
          </div>
          <ul className="max-h-56 divide-y divide-border/60 overflow-y-auto rounded-2xl border border-border/60">
            {matches.length === 0 && <li className="px-3 py-2.5 text-sm text-muted-foreground">No repositories match that search.</li>}
            {matches.map((repo) => (
              <li key={repo.fullName}>
                <button
                  type="button"
                  disabled={pending !== null}
                  onClick={() => void choose({ repository: repo.fullName }, repo.fullName)}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors hover:bg-violet-500/10 disabled:opacity-60"
                >
                  <span className="min-w-0 flex-1 truncate">{repo.fullName}</span>
                  {repo.private && <LockIcon aria-label="Private" className="size-3.5 shrink-0 text-muted-foreground" />}
                  {pending === repo.fullName && <Loader2Icon className="size-4 shrink-0 animate-spin text-violet-600" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

function ConfirmView({
  repository,
  projectName,
  notice,
  onPush,
  onChange,
}: {
  repository: GitHubLinkedRepository
  projectName: string
  notice?: string
  onPush: () => void
  onChange: () => void
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 px-3 py-2.5">
        <a href={repository.url} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2 text-sm font-medium hover:underline">
          <GithubIcon className="size-4 shrink-0" />
          <span className="truncate">{repository.fullName}</span>
        </a>
        <button type="button" onClick={onChange} className="shrink-0 text-xs font-medium text-violet-700 hover:underline">
          Change
        </button>
      </div>

      <p className="text-sm leading-relaxed text-muted-foreground">
        {repository.empty === false ? (
          <>
            This repository already has code, so {projectName} goes to a new branch. <span className="font-medium text-foreground">{repository.defaultBranch}</span> stays as it is.
          </>
        ) : repository.empty ? (
          <>
            This commits the complete project to <span className="font-medium text-foreground">{repository.defaultBranch}</span>.
          </>
        ) : (
          "This commits the complete project. Existing code is never overwritten: a repository that already has code gets a new branch."
        )}
      </p>

      {notice && (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {notice}
        </p>
      )}

      <Button className="h-10 rounded-full" onClick={onPush}>
        <GithubIcon />
        Commit and push
      </Button>
    </>
  )
}

function DoneView({ result, onClose, onChange }: { result: GitHubPushResult; onClose: () => void; onChange: () => void }) {
  const subject = result.commitMessage?.split("\n")[0]
  return (
    <>
      <p role="status" className="flex items-center gap-2 rounded-2xl bg-emerald-500/10 px-3 py-2.5 text-sm font-medium text-emerald-800">
        <CheckCircle2Icon className="size-4 shrink-0" />
        {result.outcome === "up-to-date" ? "Already up to date. There's nothing new to push." : `Pushed ${result.filesChanged} ${result.filesChanged === 1 ? "file" : "files"} to GitHub.`}
      </p>

      <dl className="space-y-2 rounded-2xl border border-border/60 px-3 py-2.5 text-sm">
        <div className="flex items-center gap-2">
          <dt className="sr-only">Repository</dt>
          <GithubIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <dd className="min-w-0 truncate">{result.repository}</dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="sr-only">Branch</dt>
          <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <dd className="min-w-0 truncate font-mono text-xs">{result.branch}</dd>
        </div>
        {subject && (
          <div>
            <dt className="sr-only">Commit message</dt>
            <dd className="text-xs leading-relaxed text-muted-foreground">{subject}</dd>
          </div>
        )}
      </dl>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" className="mr-auto rounded-full text-muted-foreground" onClick={onChange}>
          Change repository
        </Button>
        {result.compareUrl ? (
          <Button className="rounded-full" render={<a href={result.compareUrl} target="_blank" rel="noreferrer" />} nativeButton={false}>
            <GitPullRequestIcon />
            Open pull request
          </Button>
        ) : (
          <Button className="rounded-full" render={<a href={result.url} target="_blank" rel="noreferrer" />} nativeButton={false}>
            View on GitHub
            <ExternalLinkIcon />
          </Button>
        )}
        <Button variant="outline" className="rounded-full" onClick={onClose}>
          Done
        </Button>
      </div>
    </>
  )
}
