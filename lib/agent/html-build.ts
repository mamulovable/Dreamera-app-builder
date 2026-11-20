import { and, asc, eq, inArray, sql } from "drizzle-orm"

import { db, messages, projects, screens, type Project, type Screen } from "@/db"
import { htmlPagePath, toProjectScreen, type AgentEvent, type AppPlan } from "@/lib/agent-protocol"
import { mergePlan } from "@/lib/agent/changes"
import { cssProblems, generateHtmlPage, generateSiteCss, generateSiteJs, htmlPageProblems, jsProblems } from "@/lib/agent/html-site"
import { refundUnfinishedBuild } from "@/lib/billing/credits"
import { fillGeneratedImages, hasGeneratedImages } from "@/lib/imagekit"

/** The slice of a build log this step needs. Kept narrow so the build runner and this file don't import each other. */
export type HtmlBuildLog = {
  buildId: string
  signal: AbortSignal
  emit: (event: AgentEvent) => void
  flush: () => Promise<void>
}

function listNames(rows: Screen[]) {
  return rows.map((row) => row.name).join(", ")
}

/**
 * The next piece of a Website v2 build: the shared CSS, the shared script, or one
 * HTML page. Returns whether another piece remains.
 */
export async function runHtmlBuildStep(log: HtmlBuildLog, project: Project): Promise<boolean> {
  const plan = project.plan
  if (!plan) throw new Error(`Project ${project.id} has no plan to build.`)

  if (!plan.site?.css || cssProblems(plan.site.css).length > 0) {
    log.emit({ type: "status", label: "Designing the site's styles…" })
    const css = await generateSiteCss(plan, log.signal)
    if (cssProblems(css).length > 0) throw new Error("The stylesheet didn't come out usable.")
    await log.flush()
    const next = await mergePlan(project.id, { site: { css, js: plan.site?.js ?? "" } })
    log.emit({ type: "plan", plan: next })
    return true
  }

  if (!plan.site.js || jsProblems(plan.site.js).length > 0) {
    log.emit({ type: "status", label: "Writing the site's interactions…" })
    const js = await generateSiteJs(plan, log.signal)
    if (jsProblems(js).length > 0) throw new Error("The site script didn't come out usable.")
    await log.flush()
    const next = await mergePlan(project.id, { site: { css: plan.site.css, js } })
    log.emit({ type: "plan", plan: next })
    return true
  }

  const rows = await db.select().from(screens).where(eq(screens.projectId, project.id)).orderBy(asc(screens.position))
  const waiting = (row: Screen) => row.status === "pending" || row.status === "generating"
  const row = rows.find(waiting)
  if (row) {
    await writePage(log, project, plan, rows, row)
    if (rows.some(waiting)) return true
  }

  const built = rows.filter((entry) => entry.status === "done")
  const failed = rows.filter((entry) => entry.status !== "done")
  const status = failed.length === 0 ? "ready" : "failed"
  const changes = plan.pendingChanges
  await db.update(projects).set({ status }).where(eq(projects.id, project.id))
  if (changes && status === "ready") await mergePlan(project.id, { pendingChanges: null, approved: true })
  log.emit({ type: "status", label: null })
  log.emit({ type: "project-status", status })

  const refunded = status === "failed" ? await refundUnfinishedBuild(log.buildId) : 0
  const refundNote = refunded > 0 ? ` I returned the ${refunded} credits for what didn't finish.` : ""
  const content =
    failed.length === 0
      ? changes
        ? `${plan.appName} is updated. Click through the site in the preview, and tell me if you'd like anything else changed.`
        : `${plan.appName} is ready. I built ${built.length} HTML ${built.length === 1 ? "page" : "pages"}: ${listNames(built)}.\n\nClick through the site in the preview. Tell me what you'd like changed.`
      : built.length === 0
        ? `I couldn't build the pages this time.${refundNote} Use Retry on a page in the canvas and I'll try that one again.`
        : `I built ${built.length} of ${rows.length} pages. ${listNames(failed)} didn't come out right.${refundNote} Use Retry on a failed page and I'll rebuild it, keeping the finished pages.`

  const saved = await db.transaction(async (tx) => {
    if (failed.length === 0) await tx.update(messages).set({ handled: true }).where(eq(messages.projectId, project.id))
    const [message] = await tx
      .insert(messages)
      .values({ projectId: project.id, role: "assistant", content })
      .returning({ id: messages.id, role: messages.role, content: messages.content, plan: messages.plan })
    return message
  })
  log.emit({ type: "message", message: saved })
  return false
}

async function writePage(log: HtmlBuildLog, project: Project, plan: AppPlan, rows: Screen[], row: Screen) {
  const screen = plan.screens[row.position]
  const request = plan.pendingChanges?.edits[row.slug]
  const edit = row.code && request ? { code: row.code, request } : null
  const label = `${screen.name} (${row.position + 1} of ${rows.length})`
  const [generating] = await db
    .update(screens)
    .set({ status: "generating", ...(edit ? {} : { code: null }) })
    .where(eq(screens.id, row.id))
    .returning()
  Object.assign(row, generating)
  log.emit({ type: "screen", screen: toProjectScreen({ ...row, code: null }) })
  log.emit({ type: "status", label: `Writing ${label}…` })

  try {
    let code = await generateHtmlPage(plan, screen, row.position, edit, log.signal, (delta) => {
      log.emit({ type: "code-delta", screenId: row.id, delta })
    })
    const problems = htmlPageProblems(code, plan)
    if (problems.length > 0) throw new Error(problems[0])
    if (hasGeneratedImages(code)) log.emit({ type: "status", label: `Generating images for ${screen.name}…` })
    code = await fillGeneratedImages(project.id, code)
    await log.flush()
    const done = await db.transaction(async (tx) => {
      if (request) {
        await tx
          .update(projects)
          .set({ plan: sql`${projects.plan} #- ${`{pendingChanges,edits,${row.slug}}`}::text[]` })
          .where(eq(projects.id, project.id))
      }
      const [saved] = await tx.update(screens).set({ status: "done", code, filePath: htmlPagePath(screen.id, row.position) }).where(eq(screens.id, row.id)).returning()
      return saved
    })
    Object.assign(row, done)
  } catch (error) {
    if (log.signal.aborted || (error instanceof Error && error.message === "Another execution took over this build.")) throw error
    console.error(`Generating page "${screen.name}" failed`, error)
    const [failed] = await db.update(screens).set({ status: "failed" }).where(eq(screens.id, row.id)).returning()
    Object.assign(row, failed)
  }
  log.emit({ type: "screen", screen: toProjectScreen(row) })
}

/** Marks every unfinished page pending again. Used by the shared build queue. */
export async function queueHtmlPages(projectId: string, plan: AppPlan, onlySlugs?: string[]) {
  const existing = await db.select().from(screens).where(eq(screens.projectId, projectId)).orderBy(asc(screens.position))
  const matches =
    existing.length === plan.screens.length &&
    existing.every(
      (row, index) =>
        row.slug === plan.screens[index].id &&
        row.name === plan.screens[index].name &&
        row.filePath === htmlPagePath(plan.screens[index].id, index)
    )
  const rows = matches
    ? existing
    : await db.transaction(async (tx) => {
        await tx.delete(screens).where(eq(screens.projectId, projectId))
        return tx
          .insert(screens)
          .values(
            plan.screens.map((screen, position) => ({
              projectId,
              slug: screen.id,
              name: screen.name,
              position,
              layout: screen.layout,
              filePath: htmlPagePath(screen.id, position),
            }))
          )
          .returning()
      })
  const queued = (row: Screen) => row.status !== "done" && (!onlySlugs || onlySlugs.includes(row.slug))
  const ids = rows.filter(queued).map((row) => row.id)
  if (ids.length > 0) {
    await db.update(screens).set({ status: "pending" }).where(and(eq(screens.projectId, projectId), inArray(screens.id, ids)))
  }
  return rows.map((row) => (queued(row) ? { ...row, status: "pending" as const } : row))
}
