import { NextResponse } from "next/server"
import { asc, eq } from "drizzle-orm"

import { db, projects, screens } from "@/db"
import { toProjectScreen } from "@/lib/agent-protocol"
import { previewProject } from "@/lib/generated-app/project-files"
import { UUID_PATTERN, getProjectAccess } from "@/lib/project-access"
import { getCurrentUser } from "@/lib/session"
import { activeTheme } from "@/lib/themes"

/**
 * The app as a card or a visitor's preview runs it. Always on the local provider,
 * so a home page full of previews, or a stranger trying a public app, stays on
 * sample data in their own browser and never reaches the owner's real backend.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const notFound = NextResponse.json({ error: "Project not found." }, { status: 404 })
  if (!UUID_PATTERN.test(projectId)) return notFound

  const [project] = await db
    .select({ id: projects.id, title: projects.title, plan: projects.plan, isPublic: projects.isPublic })
    .from(projects)
    .where(eq(projects.id, projectId))
  if (!project) return notFound

  if (!project.isPublic) {
    const user = await getCurrentUser().catch(() => null)
    if (!user || !(await getProjectAccess(project.id, user.id))) return notFound
  }

  const rows = await db.select().from(screens).where(eq(screens.projectId, project.id)).orderBy(asc(screens.position))
  const plan = project.plan && { ...project.plan, backend: null }

  return NextResponse.json(
    {
      project: previewProject(plan, rows.map(toProjectScreen)),
      theme: activeTheme(plan?.themePackage),
    },
    { headers: { "Cache-Control": "no-store" } }
  )
}
