import { NextResponse } from "next/server"
import { and, desc, eq } from "drizzle-orm"

import { db, messages, projectAssets, projects, type Project } from "@/db"
import { messageWithElement, type AgentEvent, type AgentRequest, type ElementContext } from "@/lib/agent-protocol"
import { activeBuild, followBuild, startBuild } from "@/lib/agent/builds"
import { applyAppChanges } from "@/lib/agent/changes"
import { runPlannerTurn } from "@/lib/agent/planner"
import { getRun, startRun, type ProjectRun } from "@/lib/agent/runs"
import { assertCanUseAgent, chargeForBuild, PlanLimitError, planLimitResponse, refundCharge, type BuildCharge } from "@/lib/billing/credits"
import { MAX_PROMPT_LENGTH } from "@/lib/projects"
import { getCurrentUser, type SessionUser } from "@/lib/session"

// Planning takes seconds. Following a build's stream can take a few minutes, and the build runs on CloudHike Jobs.
export const maxDuration = 800

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

/**
 * Runs the AppForge agent for a project and streams its progress as
 * newline-delimited JSON `AgentEvent`s. If the agent is already working on the
 * project, `start` attaches to that run instead of starting another.
 */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const user = await getCurrentUser().catch(() => null)
  if (!user) return error("Please sign in to continue.", 401)
  if (!UUID_PATTERN.test(projectId)) return error("Project not found.", 404)

  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
  if (!project) return error("Project not found.", 404)

  const body = (await request.json().catch(() => null)) as AgentRequest | null
  if (!body || !["start", "message", "confirm"].includes(body.action)) return error("Invalid request.", 400)

  const build = await activeBuild(project.id)
  if (build) {
    if (body.action !== "start") return error("The agent is still working. Wait for it to finish first.", 409)
    return streamBuild(build.id, request)
  }

  const active = getRun(project.id)
  if (active) {
    if (body.action !== "start") return error("The agent is still working. Wait for it to finish first.", 409)
    return streamRun(active, request)
  }

  if (body.action === "message") {
    const content = String(body.content ?? "").trim()
    if (!content) return error("Write a message first.", 400)
    if (content.length > MAX_PROMPT_LENGTH) return error(`Keep your message under ${MAX_PROMPT_LENGTH} characters.`, 400)
    try {
      assertCanUseAgent(user.credits)
    } catch (cause) {
      if (cause instanceof PlanLimitError) return planLimitResponse(cause)
      throw cause
    }
    const element = readElementContext(body.element)
    await db.insert(messages).values({ projectId: project.id, role: "user", content: element ? messageWithElement(content, element) : content })
    return streamRun(startRun(project.id, (run) => respond(run, project, user)), request)
  }

  if (body.action === "confirm") {
    const plan = project.plan
    if (!plan || (project.status !== "planning" && project.status !== "failed")) {
      return error("There's no plan waiting for confirmation.", 409)
    }
    let charge: BuildCharge
    try {
      charge = await chargeForBuild(project, plan, user.plan)
    } catch (cause) {
      if (cause instanceof PlanLimitError) return planLimitResponse(cause)
      throw cause
    }
    await db.insert(messages).values({ projectId: project.id, role: "user", content: "Looks good, build it!" })
    const [reply] = await db
      .insert(messages)
      .values({
        projectId: project.id,
        role: "assistant",
        content: `On it! I'll build the ${plan.screens.length} screens one at a time, starting with ${plan.screens[0].name}.`,
      })
      .returning({ id: messages.id, role: messages.role, content: messages.content, plan: messages.plan })
    const started = await startBuild(project, plan, [{ type: "message", message: reply }], charge)
    return streamBuild(started.id, request)
  }

  // "start": pick up wherever the project is.
  if (project.status === "building" && project.plan) {
    const started = await startBuild(project, project.plan)
    return streamBuild(started.id, request)
  }
  const [last] = await db
    .select({ role: messages.role })
    .from(messages)
    .where(and(eq(messages.projectId, project.id), eq(messages.archived, false)))
    .orderBy(desc(messages.createdAt))
    .limit(1)
  if (last?.role === "user") {
    return streamRun(startRun(project.id, (run) => respond(run, project, user)), request)
  }
  return streamEvents([{ type: "done" }])
}

function readElementContext(value: unknown): ElementContext | null {
  const element = value as Partial<ElementContext> | null | undefined
  if (!element || typeof element !== "object") return null
  const { file, line, label, screen, snippet } = element
  if (typeof file !== "string" || typeof label !== "string" || typeof screen !== "string" || typeof snippet !== "string") return null
  if (!Number.isInteger(line)) return null
  return { file: file.slice(0, 200), line: line!, label: label.slice(0, 60), screen: screen.slice(0, 120), snippet }
}

/** One planner turn, then the build if the person confirmed the plan or asked to change the built app. */
async function respond(run: ProjectRun, project: Project, user: SessionUser) {
  const assets = await db
    .select({ fileName: projectAssets.fileName })
    .from(projectAssets)
    .where(eq(projectAssets.projectId, project.id))
  const { confirmed, plan, changes } = await runPlannerTurn(run, project, assets.map((a) => a.fileName), {
    plan: user.plan,
    credits: user.credits,
  })
  if (!changes && (!confirmed || !plan)) return

  // Paid for before anything changes, so a request that can't be paid for leaves the app as it was.
  let charge: BuildCharge
  try {
    charge = await chargeForBuild(project, changes ? changes.plan : plan!, user.plan)
  } catch (cause) {
    if (!(cause instanceof PlanLimitError)) throw cause
    run.emit({ type: "upgrade", reason: cause.reason })
    run.emit({ type: "error", message: cause.message })
    return
  }
  const nextPlan = changes
    ? await applyAppChanges(project.id, changes).catch(async (cause) => {
        await refundCharge(project, charge)
        throw cause
      })
    : plan!
  // Keeps this request's stream going through the build. `startRun` sends the final `done`.
  const build = await startBuild(project, nextPlan, changes ? [{ type: "plan", plan: nextPlan }] : [], charge)
  for await (const event of followBuild(build.id)) {
    if (event.type !== "done") run.emit(event)
  }
}

const encoder = new TextEncoder()
const encode = (event: AgentEvent) => encoder.encode(`${JSON.stringify(event)}\n`)

const STREAM_HEADERS = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  "X-Accel-Buffering": "no",
}

/** Streams a run's events to this request. Disconnecting stops the stream, not the run. */
function streamRun(run: ProjectRun, request: Request) {
  let unsubscribe = () => {}
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        unsubscribe()
        try {
          controller.close()
        } catch {}
      }
      unsubscribe = run.subscribe((event) => {
        try {
          controller.enqueue(encode(event))
        } catch {
          return unsubscribe()
        }
        if (event.type === "done") close()
      })
      request.signal.addEventListener("abort", close)
    },
    cancel() {
      unsubscribe()
    },
  })
  return new Response(stream, { headers: STREAM_HEADERS })
}

/** Streams a build's events to this request, from the beginning. Disconnecting doesn't affect the build. */
function streamBuild(buildId: string, request: Request) {
  const events = followBuild(buildId, request.signal)
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await events.next()
        if (done) return controller.close()
        controller.enqueue(encode(value))
      } catch (error) {
        console.error("Following the build failed", error)
        controller.error(error)
      }
    },
    async cancel() {
      await events.return(undefined)
    },
  })
  return new Response(stream, { headers: STREAM_HEADERS })
}

function streamEvents(events: AgentEvent[]) {
  return new Response(events.map((e) => JSON.stringify(e)).join("\n") + "\n", { headers: STREAM_HEADERS })
}
