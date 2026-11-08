"use client"

import * as React from "react"
import { formatDistanceToNowStrict } from "date-fns"
import { ClockIcon, GlobeIcon, ImageOffIcon, SparklesIcon } from "lucide-react"

import { demoStorageId, type useProjectPreview } from "@/hooks/use-project-preview"
import { STATUS_STYLES, type ProjectSummary } from "@/lib/projects"
import type { ElementEdits } from "@/lib/preview-protocol"
import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { AppFrame } from "@/components/workspace/app-frame"

const NO_EDITS: ElementEdits = {}

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

/**
 * Whether the element is near the screen. Each preview runs a whole app, so a
 * card only loads its app once it gets near, and stops it after it's scrolled away.
 */
export function useNearScreen<T extends Element>() {
  const ref = React.useRef<T>(null)
  const [near, setNear] = React.useState(false)
  const [seen, setSeen] = React.useState(false)

  React.useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        setNear(entry.isIntersecting)
        if (entry.isIntersecting) setSeen(true)
      },
      { rootMargin: "200px" }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return { ref, near, seen }
}

/** A card for one app. The whole card is the `action`, and `menu` sits above it. */
export const ProjectCard = React.forwardRef<
  HTMLElement,
  {
    project: ProjectSummary
    state: ReturnType<typeof useProjectPreview>
    running: boolean
    action: (className: string) => React.ReactNode
    menu?: React.ReactNode
  }
>(function ProjectCard({ project, state, running, action, menu }, ref) {
  return (
    <article
      ref={ref}
      className="group relative flex flex-col rounded-[2rem] border border-white/70 bg-white/70 p-2 shadow-[0_8px_30px_-16px_rgba(76,29,149,0.25)] backdrop-blur-sm transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_28px_50px_-20px_rgba(76,29,149,0.35)] has-[[data-card-action]:focus-visible]:ring-3 has-[[data-card-action]:focus-visible]:ring-ring/50"
    >
      <div className="relative flex h-72 items-start justify-center overflow-hidden rounded-[1.6rem] bg-linear-to-br from-violet-100 to-indigo-50">
        <div
          aria-hidden
          className="absolute -top-10 -right-10 size-36 rounded-full bg-violet-400 opacity-30 blur-2xl"
          style={project.accentColor ? { backgroundColor: project.accentColor } : undefined}
        />
        <div aria-hidden className="absolute -bottom-12 -left-8 size-32 rounded-full bg-white/60 blur-xl" />
        <div className="relative mt-7 aspect-[9/19] w-40 shrink-0 overflow-hidden rounded-[1.75rem] border-[5px] border-neutral-900 bg-white shadow-xl shadow-black/15 transition-transform duration-500 group-hover:-translate-y-2">
          <CardScreen project={project} state={state} running={running} />
        </div>
        <div className="pointer-events-none absolute top-2.5 left-2.5 flex flex-col items-start gap-1">
          {project.isPublic && project.role === "owner" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-medium text-emerald-700 backdrop-blur-md">
              <GlobeIcon className="size-3" />
              Public
            </span>
          )}
          {project.status !== "ready" && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-medium text-foreground/70 backdrop-blur-md">
              <span aria-hidden className={cn("size-1.5 rounded-full", STATUS_STYLES[project.status].dot)} />
              {STATUS_STYLES[project.status].label}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1 px-3 pt-3.5 pb-2">
        <h3 className="truncate font-semibold tracking-tight" title={project.name}>
          {action(
            "rounded-sm text-left outline-none after:absolute after:inset-0 after:rounded-[2rem] after:content-['']"
          )}
        </h3>
        <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">{project.description}</p>

        <div className="mt-auto flex items-center justify-between pt-3 text-xs text-muted-foreground">
          {project.role === "owner" ? (
            <span className="flex min-w-0 items-center gap-1.5 rounded-full bg-muted px-2.5 py-1">
              <ClockIcon className="size-3.5 shrink-0" />
              <span className="truncate">Edited {formatDistanceToNowStrict(new Date(project.updatedAt), { addSuffix: true })}</span>
            </span>
          ) : (
            <span className="flex min-w-0 items-center gap-2">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-indigo-100 to-fuchsia-100 text-[10px] font-semibold text-violet-700">
                {initials(project.owner ?? "")}
              </span>
              <span className="truncate">{project.owner}</span>
            </span>
          )}
        </div>
      </div>

      {menu && <div className="absolute top-4 right-4 z-10">{menu}</div>}
    </article>
  )
})

function CardScreen({
  project,
  state,
  running,
}: {
  project: ProjectSummary
  state: ReturnType<typeof useProjectPreview>
  running: boolean
}) {
  if (!project.hasPreview) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center">
        <span className="flex size-9 items-center justify-center rounded-xl bg-linear-to-br from-indigo-100 to-fuchsia-100 text-violet-600">
          <SparklesIcon className="size-4" />
        </span>
        <p className="text-[11px] leading-snug text-muted-foreground">Your app appears here once it's built</p>
      </div>
    )
  }
  if (state.failed) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center text-muted-foreground">
        <ImageOffIcon className="size-5" />
        <p className="text-[11px] leading-snug">Preview unavailable</p>
      </div>
    )
  }
  if (!state.preview) return <Skeleton className="size-full rounded-none" />
  if (!running) return <div className="size-full" style={{ background: state.preview.theme?.colors.background }} />
  return (
    <AppFrame
      projectId={demoStorageId(project.id)}
      project={state.preview.project}
      theme={state.preview.theme}
      route="/"
      interactive={false}
      title={`${project.name} preview`}
      syncing={false}
      edits={NO_EDITS}
    />
  )
}
