import { NextResponse } from "next/server"
import { and, desc, eq } from "drizzle-orm"

import { db, projects, users } from "@/db"
import { HAS_PREVIEW, LAST_EDITED, SUMMARY_COLUMNS, toProjectSummary } from "@/lib/project-summaries"

// Making a project private has to take it off the list right away.
export const dynamic = "force-dynamic"

const MAX_LISTED = 24

/** A public name, never an email: accounts without a name shouldn't have their address shown to everyone. */
function authorName(name: string | null) {
  return name?.trim() && !name.includes("@") ? name.trim() : "AppForge creator"
}

/** Finished apps their owners made public, for anyone to try. A build in progress waits until it's done. */
export async function GET() {
  const rows = await db
    .select({ ...SUMMARY_COLUMNS, ownerName: users.name })
    .from(projects)
    .innerJoin(users, eq(projects.userId, users.id))
    .where(and(eq(projects.isPublic, true), eq(projects.status, "ready"), HAS_PREVIEW))
    .orderBy(desc(LAST_EDITED))
    .limit(MAX_LISTED)

  return NextResponse.json(
    { projects: rows.map((row) => toProjectSummary(row, "viewer", authorName(row.ownerName))) },
    { headers: { "Cache-Control": "no-store" } }
  )
}
