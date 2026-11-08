"use client"

import * as React from "react"
import { Loader2Icon, RotateCcwIcon, RotateCwIcon, SparklesIcon, TriangleAlertIcon } from "lucide-react"

import { demoStorageId, type useProjectPreview } from "@/hooks/use-project-preview"
import type { ElementEdits } from "@/lib/preview-protocol"
import { resetPreviewStorage } from "@/lib/preview-storage"
import type { ProjectSummary } from "@/lib/projects"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { AppFrame } from "@/components/workspace/app-frame"

const NO_EDITS: ElementEdits = {}

/** A public app, running for real, for a visitor to tap through before signing up. */
export function PublicAppDialog({
  project,
  state,
  open,
  onOpenChange,
  onBuildYourOwn,
}: {
  project: ProjectSummary
  state: ReturnType<typeof useProjectPreview>
  open: boolean
  onOpenChange: (open: boolean) => void
  onBuildYourOwn: () => void
}) {
  const [reloadSignal, setReloadSignal] = React.useState(0)
  const { preview, failed, retry } = state

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(92dvh,860px)] flex-col gap-0 overflow-hidden rounded-3xl p-0 sm:max-w-3xl md:flex-row">
        <div className="min-h-0 flex-1 bg-linear-to-b from-violet-50/80 to-white p-4 sm:p-6">
          {/* The phone takes all the room there is, keeping its shape on any screen. */}
          <div className="flex size-full items-center justify-center [container-type:size]">
            <div className="relative aspect-[9/19] w-[min(100cqw,calc(100cqh*9/19))]">
              <div
                aria-hidden
                className="absolute -inset-6 rounded-full bg-linear-to-br from-indigo-300/30 via-fuchsia-300/25 to-violet-300/30 blur-3xl"
              />
              <div className="relative size-full overflow-hidden rounded-[2.75rem] border-[8px] border-neutral-900 bg-white shadow-[0_32px_64px_-24px_rgba(76,29,149,0.45)]">
                {preview ? (
                  <AppFrame
                    projectId={demoStorageId(project.id)}
                    project={preview.project}
                    theme={preview.theme}
                    route="/"
                    interactive
                    title={`${project.name}, running`}
                    syncing={false}
                    reloadSignal={reloadSignal}
                    edits={NO_EDITS}
                  />
                ) : failed ? (
                  <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                    <TriangleAlertIcon className="size-6 text-muted-foreground" />
                    <p className="text-sm font-medium">This app couldn't be loaded</p>
                    <Button variant="outline" className="rounded-full" onClick={retry}>
                      <RotateCwIcon />
                      Try again
                    </Button>
                  </div>
                ) : (
                  <p role="status" className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Loader2Icon className="size-4 animate-spin" />
                    Loading app…
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        <aside className="flex shrink-0 flex-col gap-3 border-t border-border/60 p-5 md:w-72 md:border-t-0 md:border-l md:p-6 md:pt-12">
          <div className="min-w-0 space-y-1 pr-8 md:pr-0">
            <DialogTitle className="truncate text-lg font-semibold tracking-tight">{project.name}</DialogTitle>
            <DialogDescription className="line-clamp-2 md:line-clamp-none">{project.description}</DialogDescription>
            <p className="text-xs text-muted-foreground">Made by {project.owner}</p>
          </div>

          <p className="hidden rounded-2xl bg-violet-500/10 px-3 py-2.5 text-xs leading-relaxed text-violet-800 md:block">
            This is the real app, running on sample data. Tap around: nothing you do here reaches anyone else.
          </p>

          <div className="flex gap-2 md:mt-auto md:flex-col">
            <Button
              className="h-10 flex-1 rounded-full bg-linear-to-r from-indigo-500 via-violet-500 to-fuchsia-500 text-white shadow-md shadow-violet-500/30 hover:opacity-95 md:flex-none"
              onClick={onBuildYourOwn}
            >
              <SparklesIcon />
              Build your own
            </Button>
            <Button
              variant="outline"
              className="h-10 rounded-full"
              disabled={!preview}
              aria-label="Start over with the sample data"
              onClick={() => {
                resetPreviewStorage(demoStorageId(project.id))
                setReloadSignal((n) => n + 1)
              }}
            >
              <RotateCcwIcon />
              <span className="hidden md:inline">Start over</span>
            </Button>
          </div>
        </aside>
      </DialogContent>
    </Dialog>
  )
}
