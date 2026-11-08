import { NextResponse } from "next/server"

import { GitHubError } from "@/lib/github/client"
import {
  REPO_FULL_NAME,
  REPO_NAME,
  createAndLinkRepository,
  getGitHubStatus,
  linkExistingRepository,
  pushProject,
} from "@/lib/github/projects"
import type { GitHubPushEvent } from "@/lib/github-protocol"
import { ExportUnavailableError, getProjectAccess } from "@/lib/project-access"
import { getCurrentUser, type SessionUser } from "@/lib/session"

// A push is one request to GitHub for each changed file, which takes seconds but not many of them.
export const maxDuration = 300

type Context = { params: Promise<{ projectId: string }> }

function error(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

/** Only the owner decides where a project's code goes. */
async function ownedProject({ params }: Context) {
  const { projectId } = await params
  const user = await getCurrentUser().catch(() => null)
  if (!user) return { failure: error("Please sign in to continue.", 401) }
  const access = await getProjectAccess(projectId, user.id)
  if (access?.role !== "owner") return { failure: error("Project not found.", 404) }
  return { user: user as SessionUser, project: access.project }
}

export async function GET(_request: Request, context: Context) {
  const owned = await ownedProject(context)
  if (owned.failure) return owned.failure
  try {
    return NextResponse.json(await getGitHubStatus(owned.project.id, owned.user.id))
  } catch (cause) {
    console.error("Reading GitHub status failed", cause)
    return error("We couldn't check your GitHub connection. Please try again.", 500)
  }
}

/** Chooses the repository this project pushes to: an existing one, or a new one created here. */
export async function PUT(request: Request, context: Context) {
  const owned = await ownedProject(context)
  if (owned.failure) return owned.failure
  const { user, project } = owned

  const body = (await request.json().catch(() => null)) as {
    repository?: unknown
    create?: { name?: unknown; private?: unknown }
  } | null

  try {
    if (typeof body?.repository === "string") {
      if (!REPO_FULL_NAME.test(body.repository)) return error("Choose a repository from the list.", 400)
      await linkExistingRepository(project.id, user.id, body.repository)
    } else if (body?.create) {
      const name = typeof body.create.name === "string" ? body.create.name.trim() : ""
      if (!REPO_NAME.test(name) || name === "." || name === "..") {
        return error("Repository names can only use letters, numbers, hyphens, underscores, and periods.", 400)
      }
      const description = project.plan?.tagline ?? `${project.title}, built with AppForge`
      await createAndLinkRepository(project.id, user.id, name, body.create.private !== false, description)
    } else {
      return error("Invalid request.", 400)
    }
    return NextResponse.json(await getGitHubStatus(project.id, user.id))
  } catch (cause) {
    if (cause instanceof GitHubError) return error(cause.message, cause.code === "reauth" ? 401 : 400, cause.code)
    console.error("Choosing a GitHub repository failed", cause)
    return error("We couldn't set up that repository. Please try again.", 500)
  }
}

const STREAM_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
}

/** Pushes the project, streaming progress as newline-delimited JSON `GitHubPushEvent`s. */
export async function POST(_request: Request, context: Context) {
  const owned = await ownedProject(context)
  if (owned.failure) return owned.failure
  const { user, project } = owned

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Leaving the page doesn't stop a push halfway, so it's still recorded when it's done.
      const emit = (event: GitHubPushEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
        } catch {}
      }
      try {
        const result = await pushProject(project, user.id, (label, percent) => emit({ type: "progress", label, percent }))
        emit({ type: "done", result })
      } catch (cause) {
        if (cause instanceof GitHubError) {
          emit({ type: "error", message: cause.message, code: cause.code })
        } else if (cause instanceof ExportUnavailableError) {
          emit({ type: "error", message: cause.message })
        } else {
          console.error("Pushing to GitHub failed", cause)
          emit({ type: "error", message: "We couldn't push your project. Please try again." })
        }
      }
      try {
        controller.close()
      } catch {}
    },
  })
  return new Response(stream, { headers: STREAM_HEADERS })
}
