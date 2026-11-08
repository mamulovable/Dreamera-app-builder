import { randomUUID } from "node:crypto"
import { and, asc, eq, gt, sql, type SQL } from "drizzle-orm"

import { buildEvents, builds, db, projects, screens, type Project } from "@/db"
import { toProjectScreen, type AgentEvent, type AppPlan } from "@/lib/agent-protocol"
import { prepareScreens } from "@/lib/agent/builder"
import { refundCharge, refundUnfinishedBuild, type BuildCharge } from "@/lib/billing/credits"
import { getJobRun, jobsCanReachApp, startJobRun } from "@/lib/jobs"

export const BUILD_WORKER_PATH = "/api/jobs/build-step"

// How often writers save events and readers look for them, so about the delay a browser sees.
const FLUSH_MS = 200
const POLL_MS = 300
// How often a reader checks the build's Jobs run while no events arrive.
const RECONCILE_MS = 10_000
// A step that succeeded queues the next one right after, so a longer gap means it never did.
const STALLED_MS = 60_000

// A failed step is safe to run again: finished screens are kept.
const JOB_RETRIES = 2

const FAILED_MESSAGE = 'The build stopped before it finished. Say "try again" and I\'ll pick up where it left off.'

export class BuildLostError extends Error {
  constructor() {
    super("Another execution took over this build.")
  }
}

/**
 * Saves a build's events for browsers to read. Events are batched, so streamed
 * code doesn't cost a write per token. If another execution takes over the
 * build, `signal` aborts and flushing throws `BuildLostError`.
 */
export class BuildLog {
  private pending: AgentEvent[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private flushing: Promise<void> = Promise.resolve()
  private controller = new AbortController()

  constructor(
    readonly buildId: string,
    private lease: string
  ) {}

  get signal() {
    return this.controller.signal
  }

  emit(event: AgentEvent) {
    const last = this.pending.at(-1)
    if (event.type === "code-delta" && last?.type === "code-delta" && last.screenId === event.screenId) {
      this.pending[this.pending.length - 1] = { ...last, delta: last.delta + event.delta }
    } else {
      this.pending.push(event)
    }
    this.timer ??= setTimeout(() => {
      this.flush().catch((error) => {
        if (!(error instanceof BuildLostError)) console.error("Saving build events failed", error)
      })
    }, FLUSH_MS)
  }

  flush() {
    const next = this.flushing.catch(() => {}).then(() => this.write())
    this.flushing = next
    return next
  }

  private async write() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.signal.aborted) throw new BuildLostError()
    if (this.pending.length === 0) return

    const batch = this.pending
    this.pending = []
    try {
      // The row lock keeps batches in order, so a reader never sees a gap it would skip.
      const saved = await db.transaction(async (tx) => {
        const [build] = await tx
          .update(builds)
          .set({ lastSeq: sql`${builds.lastSeq} + ${batch.length}` })
          .where(and(eq(builds.id, this.buildId), eq(builds.lease, this.lease), eq(builds.status, "active")))
          .returning({ lastSeq: builds.lastSeq })
        if (!build) return false
        const first = build.lastSeq - batch.length + 1
        await tx.insert(buildEvents).values(batch.map((event, i) => ({ buildId: this.buildId, seq: first + i, event })))
        return true
      })
      if (saved) return
    } catch (error) {
      this.pending = [...batch, ...this.pending]
      throw error
    }
    this.controller.abort(new BuildLostError())
    throw new BuildLostError()
  }
}

async function takeLease(buildId: string, where?: SQL, changes?: Partial<typeof builds.$inferInsert>) {
  const lease = randomUUID()
  const [build] = await db
    .update(builds)
    .set({ ...changes, lease })
    .where(and(eq(builds.id, buildId), eq(builds.status, "active"), where))
    .returning()
  return build ? { build, log: new BuildLog(buildId, lease) } : null
}

export async function activeBuild(projectId: string) {
  const [build] = await db
    .select()
    .from(builds)
    .where(and(eq(builds.projectId, projectId), eq(builds.status, "active")))
  return build ?? null
}

/**
 * Queues a build of `plan`, or returns the one already running. `firstEvents` open its stream.
 * `charge` is what was already paid for it. Picking up an interrupted build has none, as that was paid for when it began.
 */
export async function startBuild(project: Project, plan: AppPlan, firstEvents: AgentEvent[] = [], charge?: BuildCharge) {
  // Earlier builds' events are only useful while someone can still be reading them.
  await db.delete(builds).where(and(eq(builds.projectId, project.id), eq(builds.status, "finished")))
  const lease = randomUUID()
  const [build] = await db
    .insert(builds)
    .values({ id: charge?.id, projectId: project.id, lease, creditsCharged: charge?.credits ?? 0 })
    .onConflictDoNothing()
    .returning()
  if (!build) {
    if (charge) await refundCharge(project, charge)
    return (await activeBuild(project.id))!
  }

  const log = new BuildLog(build.id, lease)
  for (const event of firstEvents) log.emit(event)
  try {
    log.emit({ type: "status", label: plan.pendingChanges ? "Preparing your changes…" : `Preparing to build ${plan.screens.length} screens…` })
    const rows = await prepareScreens(project.id, plan)
    await db.update(projects).set({ status: "building" }).where(eq(projects.id, project.id))
    log.emit({ type: "project-status", status: "building" })
    log.emit({ type: "screens", screens: rows.map(toProjectScreen) })
    await log.flush()

    if (jobsCanReachApp()) {
      const jobId = await startJobRun({ path: BUILD_WORKER_PATH, body: { buildId: build.id, step: 1 }, retries: JOB_RETRIES })
      // The worker may have claimed the step already, and it records the same run.
      await db.update(builds).set({ jobId }).where(eq(builds.id, build.id))
    } else if (process.env.NODE_ENV === "production") {
      throw new Error("CloudHike Jobs can't reach this app. Set JOBS_PUBLIC_URL to its public URL.")
    } else {
      console.info("CloudHike Jobs can't reach localhost. Running this build in the dev server.")
      const { startLocalBuild } = await import("@/lib/agent/local-build")
      startLocalBuild(build.id)
    }
  } catch (error) {
    console.error("Starting the build failed", error)
    await failBuild(build.id, "Couldn't start the build. Please try again.")
  }
  return build
}

/**
 * Takes the build for a delivery of `step`, or returns null if it's a duplicate
 * of an earlier step. A retried step takes over, stopping any older execution.
 */
export async function claimBuildStep(buildId: string, step: number, jobId: string | null) {
  return takeLease(buildId, sql`${builds.step} <= ${step}`, { step, ...(jobId ? { jobId } : {}) })
}

/** Queues the step after `step`. */
export async function queueNextStep(buildId: string, step: number) {
  const next = step + 1
  const jobId = await startJobRun({ path: BUILD_WORKER_PATH, body: { buildId, step: next }, retries: JOB_RETRIES })
  await db
    .update(builds)
    .set({ jobId, step: next })
    .where(and(eq(builds.id, buildId), eq(builds.step, step)))
}

/** Ends the stream of a build whose work is complete. */
export async function finishBuild(buildId: string, log: BuildLog) {
  log.emit({ type: "done" })
  await log.flush()
  await db.update(builds).set({ status: "finished", lease: null }).where(eq(builds.id, buildId))
}

/** Ends a build that can't continue, stopping any execution still working on it. */
export async function failBuild(buildId: string, message = FAILED_MESSAGE, onlyIfJobId?: string) {
  const claimed = await takeLease(buildId, onlyIfJobId ? eq(builds.jobId, onlyIfJobId) : undefined)
  if (!claimed) return
  const { build, log } = claimed

  const stuck = await db
    .update(screens)
    .set({ status: "failed" })
    .where(and(eq(screens.projectId, build.projectId), sql`${screens.status} in ('pending', 'generating')`))
    .returning()
  await db.update(projects).set({ status: "failed" }).where(eq(projects.id, build.projectId))
  await refundUnfinishedBuild(buildId).catch((error) => console.error(`Refunding build ${buildId} failed`, error))

  stuck.sort((a, b) => a.position - b.position)
  for (const row of stuck) log.emit({ type: "screen", screen: toProjectScreen(row) })
  log.emit({ type: "status", label: null })
  log.emit({ type: "project-status", status: "failed" })
  log.emit({ type: "error", message })
  await finishBuild(buildId, log)
}

/** Fails the build if its Jobs run ended without finishing it. Returns whether the build is still active. */
async function reconcileBuild(buildId: string) {
  const [build] = await db.select().from(builds).where(eq(builds.id, buildId))
  if (build?.status !== "active") return false
  if (!build.jobId) return true

  const job = await getJobRun(build.jobId).catch((error) => {
    console.error("Reading the build's job failed", error)
    return null
  })
  const stalled = job?.status === "succeeded" && Date.now() - build.updatedAt.getTime() > STALLED_MS
  if (job?.status === "failed" || job?.status === "cancelled" || stalled) {
    console.error(`Build ${buildId}: job ${job.id} ended as ${job.status}`, job.error)
    await failBuild(buildId, FAILED_MESSAGE, build.jobId)
  }
  return true
}

/**
 * A build's events from the beginning, following new ones until it's done. The
 * client rebuilds its state from them, so a browser can attach at any time.
 */
export async function* followBuild(buildId: string, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
  let seq = 0
  let checkedAt = Date.now()
  let active = true

  while (!signal?.aborted) {
    const rows = await db
      .select({ seq: buildEvents.seq, event: buildEvents.event })
      .from(buildEvents)
      .where(and(eq(buildEvents.buildId, buildId), gt(buildEvents.seq, seq)))
      .orderBy(asc(buildEvents.seq))
      .limit(500)

    for (const row of rows) {
      seq = row.seq
      yield row.event
      if (row.event.type === "done") return
    }
    if (rows.length > 0) continue
    if (!active) {
      yield { type: "done" }
      return
    }

    if (Date.now() - checkedAt > RECONCILE_MS) {
      checkedAt = Date.now()
      active = await reconcileBuild(buildId)
      if (!active) continue
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
}
