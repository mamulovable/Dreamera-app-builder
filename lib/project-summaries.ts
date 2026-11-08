// What the project lists on the home page read. Server only.

import { sql } from "drizzle-orm"

import { projects } from "@/db"
import type { ProjectStatus, ProjectSummary } from "@/lib/projects"

// These name their columns outright, because Drizzle drops the table from column
// references when a query has one table, which would break the correlated subqueries.
export const HAS_PREVIEW = sql`exists (select 1 from screens s where s.project_id = projects.id and s.code is not null)`

/** Editing a screen only touches the screen, so this looks at those too. */
export const LAST_EDITED = sql`greatest(projects.updated_at, (select max(s.updated_at) from screens s where s.project_id = projects.id))`

/** Reads single values out of the plan, which also holds all of the app's data and shared components. */
export const SUMMARY_COLUMNS = {
  id: projects.id,
  title: projects.title,
  appName: sql<string | null>`projects.plan->>'appName'`,
  tagline: sql<string | null>`projects.plan->>'tagline'`,
  accentColor: sql<string | null>`projects.plan->'design'->>'primaryColor'`,
  status: projects.status,
  isPublic: projects.isPublic,
  hasPreview: sql<boolean>`${HAS_PREVIEW}`,
  updatedAt: sql<Date>`${LAST_EDITED}`.mapWith(projects.updatedAt),
}

type SummaryRow = {
  id: string
  title: string
  appName: string | null
  tagline: string | null
  accentColor: string | null
  status: ProjectStatus
  isPublic: boolean
  hasPreview: boolean
  updatedAt: Date
}

export function toProjectSummary(row: SummaryRow, role: ProjectSummary["role"], owner: string | null): ProjectSummary {
  return {
    id: row.id,
    name: row.appName || row.title,
    description: row.tagline ?? "",
    status: row.status,
    isPublic: row.isPublic,
    hasPreview: row.hasPreview,
    updatedAt: row.updatedAt.toISOString(),
    accentColor: row.accentColor,
    role,
    owner,
  }
}
