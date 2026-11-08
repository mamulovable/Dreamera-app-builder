import { NextResponse } from "next/server"

import { PublishBlockedError } from "@/lib/publish/builds"
import { ExpoError } from "@/lib/publish/expo"
import { getWebPublish, startWebPublish } from "@/lib/publish/web"
import { ExportUnavailableError, getProjectAccess } from "@/lib/project-access"
import { getCurrentUser } from "@/lib/session"

// Only sending the project to Expo happens in this request, which takes seconds. The deploy itself runs on EAS.
export const maxDuration = 300

type Context = { params: Promise<{ projectId: string }> }

function error(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

/** Publishing uses the owner's Expo account, so only the owner can do it. */
async function ownedProject({ params }: Context) {
  const { projectId } = await params
  const user = await getCurrentUser().catch(() => null)
  if (!user) return { failure: error("Please sign in to continue.", 401) }
  const access = await getProjectAccess(projectId, user.id)
  if (access?.role !== "owner") return { failure: error("Project not found.", 404) }
  return { user, project: access.project }
}

/** Where the project's website stands. `web` is null until its first publish. */
export async function GET(_request: Request, context: Context) {
  const owned = await ownedProject(context)
  if (owned.failure) return owned.failure
  try {
    return NextResponse.json({ web: await getWebPublish(owned.project.id, owned.user.id) })
  } catch (cause) {
    console.error("Reading the website's status failed", cause)
    return error("We couldn't check on your website. Please try again.", 500)
  }
}

/** Publishes or updates the website, and returns as soon as Expo has the app. */
export async function POST(_request: Request, context: Context) {
  const owned = await ownedProject(context)
  if (owned.failure) return owned.failure
  try {
    return NextResponse.json({ web: await startWebPublish(owned.project, owned.user.id) })
  } catch (cause) {
    if (cause instanceof PublishBlockedError) return error(cause.message, cause.status, cause.code)
    if (cause instanceof ExportUnavailableError) return error(cause.message, 409)
    if (cause instanceof ExpoError) return error(cause.message, 502)
    console.error("Publishing the website failed", cause)
    return error("We couldn't start publishing. Please try again.", 500)
  }
}
