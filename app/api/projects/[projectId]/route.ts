import { NextResponse } from "next/server"
import { and, eq, isNotNull, sql } from "drizzle-orm"

import { db, projectAssets, projects, screens } from "@/db"
import { activeBuild } from "@/lib/agent/builds"
import { getRun } from "@/lib/agent/runs"
import { getProjectAccess } from "@/lib/project-access"
import { MAX_PROJECT_NAME_LENGTH } from "@/lib/projects"
import { getCurrentUser } from "@/lib/session"
import { deleteObjects } from "@/lib/storage"

type Context = { params: Promise<{ projectId: string }> }

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

/** Only the owner renames, publishes, or deletes a project. */
async function ownedProject({ params }: Context) {
  const { projectId } = await params
  const user = await getCurrentUser().catch(() => null)
  if (!user) return { failure: error("Please sign in to continue.", 401) }
  const access = await getProjectAccess(projectId, user.id)
  if (access?.role !== "owner") return { failure: error("Project not found.", 404) }
  return { project: access.project }
}

async function isAgentWorking(project: { id: string; status: string }) {
  return project.status === "building" || Boolean(getRun(project.id)) || Boolean(await activeBuild(project.id))
}

/** Renames the project, or changes whether it's public. */
export async function PATCH(request: Request, context: Context) {
  const owned = await ownedProject(context)
  if (owned.failure) return owned.failure
  const { project } = owned

  const body = (await request.json().catch(() => null)) as { name?: unknown; isPublic?: unknown } | null
  if (typeof body?.isPublic === "boolean") {
    if (body.isPublic) {
      const [built] = await db
        .select({ id: screens.id })
        .from(screens)
        .where(and(eq(screens.projectId, project.id), isNotNull(screens.code)))
        .limit(1)
      if (!built) return error("Build the app before making it public.", 409)
    }
    // Who can see it isn't an edit, so the card's "Edited" time and place in the list stay put.
    await db
      .update(projects)
      .set({ isPublic: body.isPublic, updatedAt: project.updatedAt })
      .where(eq(projects.id, project.id))
    return NextResponse.json({ isPublic: body.isPublic })
  }

  if (typeof body?.name !== "string") return error("Invalid request.", 400)
  const name = body.name.trim().replace(/\s+/g, " ")
  if (!name) return error("Give your project a name.", 400)
  if (name.length > MAX_PROJECT_NAME_LENGTH) return error(`Keep the name under ${MAX_PROJECT_NAME_LENGTH} characters.`, 400)
  // A build saves the whole plan when it finishes, which would undo the new name.
  if (await isAgentWorking(project)) return error("The agent is still working. You can rename this once it's done.", 409)

  await db
    .update(projects)
    .set({
      title: name,
      // The plan's name is the one apps are exported under.
      ...(project.plan ? { plan: sql`jsonb_set(${projects.plan}, '{appName}', to_jsonb(${name}::text))` } : {}),
    })
    .where(eq(projects.id, project.id))
  return NextResponse.json({ name })
}

/** Deletes the project and its uploaded files. What it published elsewhere stays there. */
export async function DELETE(_request: Request, context: Context) {
  const owned = await ownedProject(context)
  if (owned.failure) return owned.failure
  const { project } = owned

  if (await isAgentWorking(project)) return error("The agent is still working. You can delete this once it's done.", 409)

  const assets = await db
    .select({ storageKey: projectAssets.storageKey })
    .from(projectAssets)
    .where(eq(projectAssets.projectId, project.id))
  await db.delete(projects).where(eq(projects.id, project.id))
  await deleteObjects(assets.map((asset) => asset.storageKey)).catch((cause) => {
    console.error("Deleting a project's files failed", cause)
  })
  return NextResponse.json({ ok: true })
}
