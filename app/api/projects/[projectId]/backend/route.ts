import { NextResponse } from "next/server"
import { and, eq } from "drizzle-orm"

import { db, projects } from "@/db"
import { disconnectProject, getBackendStatus, linkProject } from "@/lib/cloudhike/backend"
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
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
  if (!project) return { failure: error("Project not found.", 404) }
  return { project, user }
}

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { failure, project, user } = await ownedProject((await params).projectId)
  if (failure) return failure
  return NextResponse.json(await getBackendStatus(project.id, user.id))
}

/** Connects this app to the CloudHike account the person already connected for another app. */
export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { failure, project, user } = await ownedProject((await params).projectId)
  if (failure) return failure
  const status = await getBackendStatus(project.id, user.id)
  if (!status.accountConnected) return error("Connect your CloudHike account first.", 409)
  await linkProject(project.id)
  return NextResponse.json(await getBackendStatus(project.id, user.id))
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { failure, project, user } = await ownedProject((await params).projectId)
  if (failure) return failure
  const status = await getBackendStatus(project.id, user.id)
  if (status.state === "provisioning") return error("The backend is being set up. Wait for that to finish first.", 409)
  await disconnectProject(project.id, user.id)
  return NextResponse.json(await getBackendStatus(project.id, user.id))
}
