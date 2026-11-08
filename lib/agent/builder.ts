import { Agent, assistant, run, user, type AgentInputItem } from "@openai/agents"
import { and, asc, eq, ne, sql } from "drizzle-orm"

import { db, messages, projects, screens, type Project, type Screen } from "@/db"
import { componentLabel, screenFilePath, toProjectScreen, type AppPlan, type PendingChanges } from "@/lib/agent-protocol"
import { mergePlan } from "@/lib/agent/changes"
import { generateComponents, writeComponent } from "@/lib/agent/components"
import { BUILDER_MODEL, configureAgents } from "@/lib/agent/config"
import { changeCollections, generateFoundation } from "@/lib/agent/foundation"
import { BUILDER_INSTRUCTIONS, builderPrompt } from "@/lib/agent/instructions"
import { BuildLostError, type BuildLog } from "@/lib/agent/builds"
import { fatalScreenProblem, screenProblems, visibleCode } from "@/lib/agent/validate-screen"
import { refundUnfinishedBuild } from "@/lib/billing/credits"
import { isBackendLinked, setUpBackend } from "@/lib/cloudhike/backend"
import { fillGeneratedImages, hasGeneratedImages } from "@/lib/imagekit"

const builderAgent = new Agent({
  name: "AppForge Screen Builder",
  model: BUILDER_MODEL,
  instructions: BUILDER_INSTRUCTIONS,
})

// Keeps the style reference prompt small.
const MAX_STYLE_REFERENCE = 8000

/** The project's screen rows for `plan`, recreated when the plan's screens changed. */
async function syncScreens(projectId: string, plan: AppPlan) {
  const existing = await db
    .select()
    .from(screens)
    .where(eq(screens.projectId, projectId))
    .orderBy(asc(screens.position))

  const matchesPlan =
    existing.length === plan.screens.length &&
    existing.every(
      (row, i) =>
        row.slug === plan.screens[i].id &&
        row.name === plan.screens[i].name &&
        row.filePath === screenFilePath(row.slug, i, plan.screens[i].tab)
    )
  if (matchesPlan) return existing

  return db.transaction(async (tx) => {
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
          filePath: screenFilePath(screen.id, position, screen.tab),
        }))
      )
      .returning()
  })
}

/**
 * The screen rows for a new build of `plan`. Finished screens are kept and the
 * rest are queued again. Only a screen waiting for an edit has code here, and it
 * keeps that until the new code is ready.
 */
export async function prepareScreens(projectId: string, plan: AppPlan) {
  const rows = await syncScreens(projectId, plan)
  await db
    .update(screens)
    .set({ status: "pending" })
    .where(and(eq(screens.projectId, projectId), ne(screens.status, "done")))
  return rows.map((row) => (row.status === "done" ? row : { ...row, status: "pending" as const }))
}

function listNames(names: string[]) {
  if (names.length < 2) return names.join("")
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
}

/** The message for a finished round of changes to a built app. */
function changesSummary({ added, updated, removed, failed = [] }: PendingChanges) {
  const done = [
    added.length > 0 && `added ${listNames(added)}`,
    updated.length > 0 && `updated ${listNames(updated)}`,
    removed.length > 0 && `removed ${listNames(removed)}`,
  ].filter((part): part is string => Boolean(part))
  const what = done.length > 0 ? `I ${listNames(done)}.` : "Your changes are in."
  const missed = failed.length > 0 ? ` I couldn't change ${listNames(failed)}, so ${failed.length === 1 ? "it's" : "they're"} still as before. Ask me again if you'd still like that.` : ""
  return `All done! ${what}${missed} Have a look in the preview, and tell me if you'd like anything else changed.`
}

/**
 * Does the next piece of a build: the foundation, or one screen, streaming each
 * file's code as it's written. Pieces that are already done are kept, so this
 * can run again after an interruption. Returns whether there's more to do.
 */
export async function runBuildStep(log: BuildLog, project: Project): Promise<boolean> {
  configureAgents()

  const plan = project.plan
  if (!plan) throw new Error(`Project ${project.id} has no plan to build.`)

  if (!plan.themePackage || !plan.collections) {
    log.emit({ type: "status", label: "Designing your themes and sample data…" })
    const foundation = await generateFoundation(plan)
    if (hasGeneratedImages(foundation.collections)) log.emit({ type: "status", label: "Generating your app's images…" })
    const next = { ...plan, ...foundation, collections: await fillGeneratedImages(project.id, foundation.collections) }
    await log.flush()
    await db.update(projects).set({ plan: next }).where(eq(projects.id, project.id))
    log.emit({ type: "plan", plan: next })
    return true
  }

  const changes = plan.pendingChanges
  if (changes?.data) {
    log.emit({ type: "status", label: "Updating your app's data…" })
    const collections = await fillGeneratedImages(project.id, await changeCollections(plan, changes.data))
    await log.flush()
    const next = await mergePlan(project.id, { collections, pendingChanges: { ...changes, data: null } })
    log.emit({ type: "plan", plan: next })
    return true
  }

  const rows = await db
    .select()
    .from(screens)
    .where(eq(screens.projectId, project.id))
    .orderBy(asc(screens.position))
  const isWaiting = (row: Screen) => row.status === "pending" || row.status === "generating"

  // Apps built before shared components existed keep their screens as they are.
  if (!plan.components && !rows.some((row) => row.code)) {
    log.emit({ type: "status", label: "Building your reusable components…" })
    const components = await fillGeneratedImages(project.id, await generateComponents(plan))
    await log.flush()
    const next = await mergePlan(project.id, { components })
    log.emit({ type: "plan", plan: next })
    return true
  }

  // Comes before the screens, since they may use what changes here. One at a time, so an interruption keeps what's done.
  const componentChange = changes && Object.entries(changes.components ?? {})[0]
  if (componentChange) {
    const [name, { purpose, request }] = componentChange
    const library = plan.components ?? []
    const current = library.find((component) => component.name === name)
    log.emit({ type: "status", label: `Updating ${componentLabel(name)}…` })
    const code = await fillGeneratedImages(project.id, await writeComponent(plan, { name, purpose }, current?.code ?? null, request))
    await log.flush()
    const { [name]: _done, ...waiting } = changes.components!
    const next = await mergePlan(project.id, {
      components: !code
        ? library
        : current
          ? library.map((component) => (component === current ? { ...component, code } : component))
          : [...library, { name, purpose, code }],
      pendingChanges: {
        ...changes,
        components: waiting,
        failed: code ? changes.failed : [...(changes.failed ?? []), componentLabel(name)],
      },
    })
    log.emit({ type: "plan", plan: next })
    return true
  }

  const row = rows.find(isWaiting)
  if (row) {
    const screen = plan.screens[row.position]
    const request = changes?.edits[row.slug]
    const edit = row.code && request ? { code: row.code, request } : null
    const styleReference = edit ? null : (rows.find((other) => other.status === "done" && other.code)?.code ?? null)
    const label = `${screen.name} (${row.position + 1} of ${rows.length})`

    // A screen being edited keeps its code here until the new code is ready, and the browser only sees the new code arrive.
    const [generating] = await db
      .update(screens)
      .set({ status: "generating", ...(edit ? {} : { code: null }) })
      .where(eq(screens.id, row.id))
      .returning()
    Object.assign(row, generating)
    const writing = () => toProjectScreen({ ...row, code: null })
    log.emit({ type: "screen", screen: writing() })
    log.emit({ type: "status", label: `Designing ${label}…` })

    /** Streams one attempt at the file to the client and returns the finished code. */
    const generate = async (input: AgentInputItem[], status: string) => {
      const result = await run(builderAgent, input, { stream: true, signal: log.signal })
      let raw = ""
      let shown = ""
      for await (const event of result) {
        if (event.type !== "raw_model_stream_event" || event.data.type !== "output_text_delta") continue
        if (!raw) log.emit({ type: "status", label: status })
        raw += event.data.delta
        const next = visibleCode(raw)
        if (next.length > shown.length && next.startsWith(shown)) {
          log.emit({ type: "code-delta", screenId: row.id, delta: next.slice(shown.length) })
          shown = next
        }
      }
      await result.completed
      log.signal.throwIfAborted()
      return `${visibleCode(raw).trim()}\n`
    }

    try {
      const prompt = user(
        builderPrompt({
          plan,
          screen,
          position: row.position,
          styleReference: styleReference?.slice(0, MAX_STYLE_REFERENCE) ?? null,
          edit,
        })
      )
      let code = await generate([prompt], `Writing ${label}…`)

      // One rewrite if the screen breaks the rules, since it wouldn't run or follow the theme.
      const problems = screenProblems(
        code,
        (plan.collections ?? []).map((c) => c.name),
        (plan.components ?? []).map((c) => c.name),
        !edit,
        edit ? `${edit.code}\n${edit.request}` : ""
      )
      if (problems.length > 0) {
        log.emit({ type: "screen", screen: writing() })
        log.emit({ type: "status", label: `Polishing ${screen.name}…` })
        code = await generate(
          [
            prompt,
            assistant(code),
            user(
              `This file has problems:\n${problems.map((problem) => `- ${problem}`).join("\n")}\nRewrite the complete file with these fixed and everything else kept. Reply with only the file.`
            ),
          ],
          `Rewriting ${label}…`
        )
      }

      const fatal = fatalScreenProblem(code)
      if (fatal) throw new Error(fatal)

      if (hasGeneratedImages(code)) log.emit({ type: "status", label: `Generating images for ${screen.name}…` })
      code = await fillGeneratedImages(project.id, code)

      // Stops here if a newer execution took over, so it can't overwrite that one's screen.
      await log.flush()
      const done = await db.transaction(async (tx) => {
        if (request) {
          await tx
            .update(projects)
            .set({ plan: sql`${projects.plan} #- ${`{pendingChanges,edits,${row.slug}}`}::text[]` })
            .where(eq(projects.id, project.id))
        }
        const [saved] = await tx
          .update(screens)
          .set({ status: "done", code })
          .where(eq(screens.id, row.id))
          .returning()
        return saved
      })
      Object.assign(row, done)
    } catch (error) {
      if (log.signal.aborted || error instanceof BuildLostError) throw error
      console.error(`Generating screen "${screen.name}" failed`, error)
      const [failed] = await db
        .update(screens)
        .set({ status: "failed" })
        .where(eq(screens.id, row.id))
        .returning()
      Object.assign(row, failed)
    }
    log.emit({ type: "screen", screen: toProjectScreen(row) })
    if (rows.some(isWaiting)) return true
  }

  const built = rows.filter((row) => row.status === "done")
  const failed = rows.filter((row) => row.status !== "done")

  // Deploying can take minutes, so it gets a step of its own. It's safe to repeat if this step is retried.
  const linked = failed.length === 0 && (await isBackendLinked(project))
  if (linked && row) return true
  let backendNote = plan.backend
    ? " Everything people add is saved to your CloudHike backend."
    : " Everything you add is saved on the device for now. Click Connect Backend at the top when you'd like it in the cloud."
  if (linked) {
    log.emit({ type: "status", label: "Setting up your backend…" })
    const result = await setUpBackend(project, { emit: (event) => log.emit(event) })
    await log.flush()
    backendNote = result.ok
      ? " Everything people add is saved to your CloudHike backend and syncs live."
      : ` I couldn't set up your CloudHike backend, so nothing moved to the cloud: ${result.message}`
  }

  const status = failed.length === 0 ? "ready" : "failed"
  await db.update(projects).set({ status }).where(eq(projects.id, project.id))
  // After a failure these stay, so trying again carries on with them.
  if (changes && status === "ready") await mergePlan(project.id, { pendingChanges: null })
  log.emit({ type: "status", label: null })
  log.emit({ type: "project-status", status })

  const refunded = status === "failed" ? await refundUnfinishedBuild(log.buildId) : 0
  const refundNote = refunded > 0 ? ` I returned the ${refunded} credits for what didn't finish.` : ""

  const names = (list: Screen[]) => list.map((row) => row.name).join(", ")
  const content =
    failed.length === 0
      ? changes
        ? `${changesSummary(changes)}${linked ? backendNote : ""}`
        : `${plan.appName} is ready! I built all ${built.length} screens: ${names(built)}.\n\nTap through the app in the preview, and try other looks from the Theme menu at the top of the canvas.${backendNote}`
      : built.length === 0
        ? `I couldn't build the screens this time.${refundNote} Say "try again" and I'll have another go.`
        : `I built ${built.length} of ${rows.length} screens. ${names(failed)} didn't come out right.${refundNote} Say "try again" and I'll retry ${failed.length === 1 ? "it" : "them"}, keeping the finished screens.`

  const saved = await db.transaction(async (tx) => {
    // Everything asked for so far is done. This message says what was, so later requests can still refer to it.
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
