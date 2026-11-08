"use client"

import Link from "next/link"
import * as React from "react"
import { ArrowRightIcon, Loader2Icon, PlusIcon, RotateCwIcon, SparklesIcon } from "lucide-react"

import { useProjectPreview } from "@/hooks/use-project-preview"
import { useAuth } from "@/lib/auth-client"
import type { ProjectSummary } from "@/lib/projects"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useUpgradeDialog } from "@/components/billing/upgrade-dialog"
import { ProjectCard, useNearScreen } from "@/components/home/project-card"
import { ProjectDialogs, ProjectMenu, sendChange, type ProjectDialogKind } from "@/components/home/project-actions"
import { PublicAppDialog } from "@/components/home/public-app-dialog"
import { useSignInDialog } from "@/components/home/sign-in-dialog"

const GRID_CLASS = "grid gap-5 sm:grid-cols-2 lg:grid-cols-4"

export function ProjectsSection() {
  const { user, isPending } = useAuth()

  if (isPending) return <SectionSkeleton />
  if (!user) return <PublicApps />
  return (
    <div className="space-y-14">
      <UserProjects />
      <SharedProjects />
    </div>
  )
}

/** Loads a list of projects. `projects` is null until the first answer. */
export function useProjectList(url: string) {
  const [projects, setProjects] = React.useState<ProjectSummary[] | null>(null)
  const [failed, setFailed] = React.useState(false)
  const [attempt, setAttempt] = React.useState(0)

  React.useEffect(() => {
    const controller = new AbortController()
    setFailed(false)
    fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`The list answered ${response.status}.`)
        return response.json() as Promise<{ projects: ProjectSummary[] }>
      })
      .then((body) => setProjects(body.projects))
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    return () => controller.abort()
  }, [attempt, url])

  const reload = React.useCallback(() => setAttempt((n) => n + 1), [])
  return { projects, setProjects, failed, reload }
}

function SectionHeading({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: React.ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  )
}

function PublicApps() {
  const { openSignIn } = useSignInDialog()
  const { projects, failed, reload } = useProjectList("/api/projects/public")

  return (
    <section id="explore" className="scroll-mt-24">
      <SectionHeading
        title="Built with AppForge"
        description="Real apps from the community. Open one and try it."
        action={
          <Button
            variant="ghost"
            size="lg"
            className="h-10 rounded-full px-4 text-muted-foreground hover:bg-violet-500/10 hover:text-violet-700"
            onClick={() => openSignIn("sign-in")}
          >
            Sign in to see your projects
            <ArrowRightIcon />
          </Button>
        }
      />

      {failed ? (
        <LoadFailed what="these apps" onRetry={reload} />
      ) : !projects ? (
        <CardSkeletons />
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[2rem] border border-border/60 bg-muted/40 px-6 py-14 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-linear-to-br from-indigo-100 to-fuchsia-100 text-violet-600">
            <SparklesIcon className="size-5" />
          </span>
          <p className="font-medium">No public apps yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">Be the first: build an app and share it with everyone here.</p>
          <Button className="mt-1 h-10 rounded-full px-5" onClick={() => openSignIn("sign-up")}>
            Get started
          </Button>
        </div>
      ) : (
        <div className={GRID_CLASS}>
          {projects.map((project) => (
            <PublicAppCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </section>
  )
}

function PublicAppCard({ project }: { project: ProjectSummary }) {
  const { openSignIn } = useSignInDialog()
  const [open, setOpen] = React.useState(false)
  const { ref, near, seen } = useNearScreen<HTMLElement>()
  const state = useProjectPreview(project.id, seen || open)

  return (
    <>
      <ProjectCard
        ref={ref}
        project={project}
        state={state}
        // Behind the dialog, the same app would only restart on every change made in it.
        running={near && !open}
        action={(className) => (
          <button type="button" data-card-action className={className} onClick={() => setOpen(true)}>
            {project.name}
          </button>
        )}
      />
      <PublicAppDialog
        project={project}
        state={state}
        open={open}
        onOpenChange={setOpen}
        onBuildYourOwn={() => {
          setOpen(false)
          openSignIn("sign-up")
        }}
      />
    </>
  )
}

function WorkspaceCard({
  project,
  onDialog,
  onDuplicate,
  onSetPublic,
}: {
  project: ProjectSummary
  onDialog: (kind: ProjectDialogKind) => void
  onDuplicate: () => void
  onSetPublic: (isPublic: boolean) => void
}) {
  const { ref, near, seen } = useNearScreen<HTMLElement>()
  const state = useProjectPreview(project.id, seen && project.hasPreview)

  return (
    <ProjectCard
      ref={ref}
      project={project}
      state={state}
      running={near}
      action={(className) => (
        <Link href={`/workspace/${project.id}`} data-card-action className={className}>
          {project.name}
        </Link>
      )}
      menu={<ProjectMenu project={project} onDialog={onDialog} onDuplicate={onDuplicate} onSetPublic={onSetPublic} />}
    />
  )
}

/** Cards that open their workspace, and the dialogs behind their menus. */
function WorkspaceCards({
  projects,
  setProjects,
  reload,
  children,
}: {
  projects: ProjectSummary[]
  setProjects: React.Dispatch<React.SetStateAction<ProjectSummary[] | null>>
  reload: () => void
  /** Comes before the projects in the grid. */
  children?: React.ReactNode
}) {
  const [active, setActive] = React.useState<{ id: string; kind: ProjectDialogKind } | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [duplicating, setDuplicating] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  // A dialog stays on its project while it animates closed.
  const [lastProject, setLastProject] = React.useState<ProjectSummary | null>(null)
  const openUpgrade = useUpgradeDialog()
  const activeProject = projects.find((project) => project.id === active?.id) ?? lastProject

  function update(id: string, change: Partial<ProjectSummary>) {
    setProjects((current) => current?.map((project) => (project.id === id ? { ...project, ...change } : project)) ?? null)
  }

  async function duplicate(project: ProjectSummary) {
    setDuplicating(project.id)
    setError(null)
    const problem = await sendChange(`/api/projects/${project.id}/duplicate`, "POST", undefined, openUpgrade)
    setDuplicating(null)
    if (problem) setError(problem)
    else reload()
  }

  async function setPublic(project: ProjectSummary, isPublic: boolean) {
    setError(null)
    update(project.id, { isPublic })
    const problem = await sendChange(`/api/projects/${project.id}`, "PATCH", { isPublic })
    if (!problem) return
    update(project.id, { isPublic: project.isPublic })
    setError(problem)
  }

  return (
    <>
      {error && (
        <p role="alert" className="mb-4 rounded-2xl bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
          {error}
        </p>
      )}
      {duplicating && (
        <p role="status" className="mb-4 flex items-center gap-2 rounded-2xl bg-violet-500/10 px-4 py-2.5 text-sm font-medium text-violet-800">
          <Loader2Icon className="size-4 animate-spin" />
          Duplicating your project…
        </p>
      )}
      <div className={GRID_CLASS}>
        {children}
        {projects.map((project) => (
          <WorkspaceCard
            key={project.id}
            project={project}
            onDialog={(kind) => {
              setLastProject(project)
              setActive({ id: project.id, kind })
              setDialogOpen(true)
            }}
            onDuplicate={() => void duplicate(project)}
            onSetPublic={(isPublic) => void setPublic(project, isPublic)}
          />
        ))}
      </div>
      <ProjectDialogs
        project={activeProject}
        kind={active?.kind ?? null}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onRenamed={(name) => active && update(active.id, { name })}
        onPublicChange={(isPublic) => active && update(active.id, { isPublic })}
        onDeleted={() => setProjects((current) => current?.filter((project) => project.id !== active?.id) ?? null)}
      />
    </>
  )
}

function UserProjects() {
  const { projects, setProjects, failed, reload } = useProjectList("/api/projects")

  return (
    <section id="projects" className="scroll-mt-24">
      <SectionHeading title="Your projects" description="Pick up where you left off, or start something new." />

      {failed && !projects ? (
        <LoadFailed what="your projects" onRetry={reload} />
      ) : !projects ? (
        <CardSkeletons />
      ) : (
        <WorkspaceCards projects={projects} setProjects={setProjects} reload={reload}>
          <NewProjectCard />
        </WorkspaceCards>
      )}
    </section>
  )
}

function SharedProjects() {
  const { projects, setProjects, reload } = useProjectList("/api/projects/shared")

  // The rest of the page is fine without this section.
  if (!projects || projects.length === 0) return null

  return (
    <section id="shared" className="scroll-mt-24">
      <SectionHeading title="Shared with you" description="Projects other people have given you access to view." />
      <WorkspaceCards projects={projects} setProjects={setProjects} reload={reload} />
    </section>
  )
}

function NewProjectCard() {
  return (
    <button
      type="button"
      onClick={() => {
        window.scrollTo({ top: 0, behavior: "smooth" })
        document.getElementById("prompt")?.focus({ preventScroll: true })
      }}
      className="group flex min-h-96 flex-col items-center justify-center gap-3 rounded-[2rem] border-2 border-dashed border-violet-200 bg-linear-to-br from-violet-50/70 to-fuchsia-50/50 text-muted-foreground transition-colors hover:border-violet-300 hover:bg-violet-50/60 hover:text-violet-700 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <span className="flex size-14 items-center justify-center rounded-full bg-linear-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-white shadow-lg shadow-violet-500/30 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-90">
        <PlusIcon className="size-5" />
      </span>
      <span className="text-sm font-medium">New project</span>
    </button>
  )
}

export function LoadFailed({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-[2rem] border border-border/60 bg-muted/40 px-6 py-14 text-center">
      <p className="text-sm text-muted-foreground">We couldn't load {what}.</p>
      <Button variant="outline" className="h-10 rounded-full px-4" onClick={onRetry}>
        <RotateCwIcon />
        Try again
      </Button>
    </div>
  )
}

function CardSkeletons() {
  return (
    <div className={GRID_CLASS} aria-busy="true">
      {Array.from({ length: 4 }).map((_, i) => (
        <Skeleton key={i} className="h-96 rounded-[2rem]" />
      ))}
    </div>
  )
}

function SectionSkeleton() {
  return (
    <section aria-busy="true">
      <Skeleton className="mb-2 h-7 w-48" />
      <Skeleton className="mb-6 h-4 w-72" />
      <CardSkeletons />
    </section>
  )
}
