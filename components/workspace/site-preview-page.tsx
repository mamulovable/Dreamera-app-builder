"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowLeftIcon, Loader2Icon, RotateCwIcon, TriangleAlertIcon } from "lucide-react"

import type { ProjectPreview } from "@/hooks/use-project-preview"
import type { ElementEdits } from "@/lib/preview-protocol"
import { Button } from "@/components/ui/button"
import { AppFrame } from "@/components/workspace/app-frame"

const NO_EDITS: ElementEdits = {}

/** The website at the real browser size, so it can be clicked through without publishing. */
export function SitePreview({ projectId }: { projectId: string }) {
  const [preview, setPreview] = React.useState<ProjectPreview | null>(null)
  const [failed, setFailed] = React.useState(false)
  const [reloadSignal, setReloadSignal] = React.useState(0)
  const [attempt, setAttempt] = React.useState(0)

  React.useEffect(() => {
    const controller = new AbortController()
    setFailed(false)
    fetch(`/api/projects/${projectId}/preview`, { signal: controller.signal, cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`The preview answered ${response.status}.`)
        return response.json() as Promise<ProjectPreview>
      })
      .then((next) => {
        setPreview(next)
        const name = next.project.brand?.name
        document.title = name ? `${name} — Preview` : "Site preview"
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    return () => controller.abort()
  }, [attempt, projectId])

  const reload = () => {
    setAttempt((n) => n + 1)
    setReloadSignal((n) => n + 1)
  }

  const name = preview?.project.brand?.name ?? "Site preview"
  const browser = preview?.project.frame === "browser"

  return (
    <div className="flex h-dvh flex-col bg-white">
      <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border/60 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href={`/workspace/${projectId}`}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-brand/10 hover:text-brand-dark"
            aria-label="Back to the workspace"
          >
            <ArrowLeftIcon className="size-4" />
          </Link>
          <p className="truncate text-sm font-medium">{name}</p>
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">Preview</span>
        </div>
        <Button variant="ghost" size="icon" className="rounded-full text-muted-foreground" aria-label="Reload preview" onClick={reload}>
          <RotateCwIcon />
        </Button>
      </header>
      <div className="relative min-h-0 flex-1">
        {preview ? (
          browser ? (
            <AppFrame
              projectId={projectId}
              project={preview.project}
              theme={preview.theme}
              route="/"
              fit="fill"
              interactive
              title={`${name} preview`}
              syncing={false}
              reloadSignal={reloadSignal}
              edits={NO_EDITS}
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-muted/40 p-6">
              <div className="relative h-full max-h-[844px] w-full max-w-[390px]">
                <AppFrame
                  projectId={projectId}
                  project={preview.project}
                  theme={preview.theme}
                  route="/"
                  interactive
                  title={`${name} preview`}
                  syncing={false}
                  reloadSignal={reloadSignal}
                  edits={NO_EDITS}
                />
              </div>
            </div>
          )
        ) : failed ? (
          <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <TriangleAlertIcon className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium">This preview couldn&apos;t be opened</p>
            <p className="max-w-sm text-sm text-muted-foreground">Sign in as the project owner, or make the project public, then try again.</p>
            <Button variant="outline" className="rounded-full" onClick={reload}>
              <RotateCwIcon />
              Try again
            </Button>
          </div>
        ) : (
          <p role="status" className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="size-4 animate-spin" />
            Loading preview…
          </p>
        )}
      </div>
    </div>
  )
}
