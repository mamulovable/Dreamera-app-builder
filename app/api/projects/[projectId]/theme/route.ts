import { NextResponse } from "next/server"
import { and, eq, sql } from "drizzle-orm"

import { db, projects } from "@/db"
import { getCurrentUser } from "@/lib/session"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

/** Saves which theme of the project's package is active. Only this one value in the plan changes. */
export async function PATCH(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const user = await getCurrentUser().catch(() => null)
  if (!user) return error("Please sign in to continue.", 401)
  if (!UUID_PATTERN.test(projectId)) return error("Project not found.", 404)

  const body = (await request.json().catch(() => null)) as { themeId?: unknown } | null
  const themeId = body?.themeId
  if (typeof themeId !== "string") return error("Invalid request.", 400)

  const [project] = await db
    .select({ plan: projects.plan })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
  if (!project) return error("Project not found.", 404)
  if (!project.plan?.themePackage?.themes.some((theme) => theme.id === themeId)) return error("Theme not found.", 404)

  await db
    .update(projects)
    .set({ plan: sql`jsonb_set(${projects.plan}, '{themePackage,activeThemeId}', to_jsonb(${themeId}::text))` })
    .where(eq(projects.id, projectId))
  return NextResponse.json({ ok: true })
}
