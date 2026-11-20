import { NextResponse } from "next/server"
import { and, eq } from "drizzle-orm"

import { db, projects } from "@/db"
import { aiProvidersConfigured } from "@/lib/ai/providers"
import type { AppAiAvailability } from "@/lib/ai/types"
import { getCurrentUser } from "@/lib/session"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

async function ownedProject(projectId: string) {
  const user = await getCurrentUser().catch(() => null)
  if (!user) return { failure: error("Please sign in to continue.", 401) }
  if (!UUID_PATTERN.test(projectId)) return { failure: error("Project not found.", 404) }
  const [project] = await db
    .select({ id: projects.id, aiEnabled: projects.aiEnabled })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
  if (!project) return { failure: error("Project not found.", 404) }
  return { project }
}

function statusOf(enabled: boolean): AppAiAvailability {
  return { enabled, ...aiProvidersConfigured() }
}

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { failure, project } = await ownedProject((await params).projectId)
  if (failure || !project) return failure
  return NextResponse.json(statusOf(project.aiEnabled))
}

/** Turns AI on or off for this app. The provider keys never leave the server. */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { failure, project } = await ownedProject((await params).projectId)
  if (failure || !project) return failure
  const body = (await request.json().catch(() => null)) as { enabled?: unknown } | null
  if (typeof body?.enabled !== "boolean") return error("Say whether AI should be on.", 400)
  if (body.enabled && !Object.values(aiProvidersConfigured()).some(Boolean)) {
    return error("AI isn't set up on this server yet.", 503)
  }
  await db.update(projects).set({ aiEnabled: body.enabled }).where(eq(projects.id, project.id))
  return NextResponse.json(statusOf(body.enabled))
}
