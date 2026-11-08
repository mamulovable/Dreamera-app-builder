import { NextResponse } from "next/server"
import { desc, eq } from "drizzle-orm"

import { db, projectShares, projects, users } from "@/db"
import { SUMMARY_COLUMNS, toProjectSummary } from "@/lib/project-summaries"
import { getCurrentUser } from "@/lib/session"

/** The projects other people have shared with the signed-in person. */
export async function GET() {
  const user = await getCurrentUser().catch(() => null)
  if (!user) return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 })

  const rows = await db
    .select({ ...SUMMARY_COLUMNS, ownerName: users.name, ownerEmail: users.email })
    .from(projectShares)
    .innerJoin(projects, eq(projectShares.projectId, projects.id))
    .innerJoin(users, eq(projects.userId, users.id))
    .where(eq(projectShares.userId, user.id))
    .orderBy(desc(projectShares.createdAt))

  return NextResponse.json({
    projects: rows.map((row) => toProjectSummary(row, "viewer", row.ownerName || row.ownerEmail)),
  })
}
