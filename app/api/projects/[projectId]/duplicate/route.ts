import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"

import { db, messages, projectAssets, projects, screens } from "@/db"
import { activeBuild } from "@/lib/agent/builds"
import { assertProjectSlot, claimProjectSlot, hasProjectSlot, PlanLimitError, planLimitResponse } from "@/lib/billing/credits"
import { getRun } from "@/lib/agent/runs"
import { getProjectAccess } from "@/lib/project-access"
import { MAX_PROJECT_NAME_LENGTH } from "@/lib/projects"
import { getCurrentUser } from "@/lib/session"
import { copyObject, deleteObjects, safeFileName } from "@/lib/storage"

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

/**
 * Copies a project with its chat, screens, and files, using no credits. The copy
 * starts private and without a backend, because the original's backend, website,
 * and repository stay the original's alone.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const user = await getCurrentUser().catch(() => null)
  if (!user) return error("Please sign in to continue.", 401)
  const access = await getProjectAccess(projectId, user.id)
  if (access?.role !== "owner") return error("Project not found.", 404)
  const { project } = access

  if (project.status === "building" || getRun(project.id) || (await activeBuild(project.id))) {
    return error("The agent is still working. You can duplicate this once it's done.", 409)
  }

  try {
    assertProjectSlot(await hasProjectSlot(user.id, user.plan), user.plan)
  } catch (cause) {
    if (cause instanceof PlanLimitError) return planLimitResponse(cause)
    throw cause
  }

  const newId = crypto.randomUUID()
  const name = `${(project.plan?.appName || project.title).slice(0, MAX_PROJECT_NAME_LENGTH - 5)} copy`

  const [assetRows, messageRows, screenRows] = await Promise.all([
    db.select().from(projectAssets).where(eq(projectAssets.projectId, project.id)),
    db.select().from(messages).where(eq(messages.projectId, project.id)),
    db.select().from(screens).where(eq(screens.projectId, project.id)),
  ])

  const assets = assetRows.map((asset) => ({
    ...asset,
    newKey: `users/${user.id}/projects/${newId}/assets/${crypto.randomUUID()}-${safeFileName(asset.fileName)}`,
  }))
  const copies = await Promise.allSettled(assets.map((asset) => copyObject(asset.storageKey, asset.newKey)))
  const copiedKeys = assets.filter((_, i) => copies[i].status === "fulfilled").map((asset) => asset.newKey)

  if (copiedKeys.length < assets.length) {
    console.error(
      "Copying a project's files failed",
      copies.find((copy): copy is PromiseRejectedResult => copy.status === "rejected")?.reason
    )
    await deleteObjects(copiedKeys).catch(() => {})
    return error("We couldn't copy this project's files. Please try again.", 502)
  }

  try {
    await db.transaction(async (tx) => {
      await claimProjectSlot(tx, user.id)
      await tx.insert(projects).values({
        id: newId,
        userId: user.id,
        title: name,
        prompt: project.prompt,
        platform: project.platform,
        status: project.status,
        plan: project.plan && { ...project.plan, appName: name, backend: null, pendingChanges: null },
      })
      if (messageRows.length > 0) {
        await tx.insert(messages).values(
          messageRows.map((message) => ({
            projectId: newId,
            role: message.role,
            content: message.content,
            plan: message.plan,
            handled: message.handled,
            archived: message.archived,
            // The chat is read in this order.
            createdAt: message.createdAt,
          }))
        )
      }
      if (screenRows.length > 0) {
        await tx.insert(screens).values(
          screenRows.map((screen) => ({
            projectId: newId,
            slug: screen.slug,
            name: screen.name,
            position: screen.position,
            status: screen.status,
            layout: screen.layout,
            filePath: screen.filePath,
            code: screen.code,
          }))
        )
      }
      if (assets.length > 0) {
        await tx.insert(projectAssets).values(
          assets.map((asset) => ({
            projectId: newId,
            storageKey: asset.newKey,
            fileName: asset.fileName,
            contentType: asset.contentType,
            size: asset.size,
          }))
        )
      }
    })
    return NextResponse.json({ id: newId }, { status: 201 })
  } catch (cause) {
    await deleteObjects(copiedKeys).catch(() => {})
    if (cause instanceof PlanLimitError) return planLimitResponse(cause)
    console.error("Duplicating a project failed", cause)
    return error("We couldn't duplicate this project. Please try again.", 500)
  }
}
