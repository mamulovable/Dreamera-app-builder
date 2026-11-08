// A project's CloudHike backend: connecting it, deploying what it needs, and
// reporting on it. Server only, and nothing returned from here holds a secret.

import { and, eq, inArray, lt, ne, sql } from "drizzle-orm"

import { cloudhikeConnections, db, projectBackends, projects, screens, type Project, type ProjectBackend } from "@/db"
import type { AgentEvent, AppPlan } from "@/lib/agent-protocol"
import { mergePlan } from "@/lib/agent/changes"
import type { AppBackend, BackendService, BackendServiceStatus, BackendStatus } from "@/lib/backend-protocol"
import {
  CloudHikeAuthError,
  CloudHikeClient,
  CloudHikeError,
  cloudhikeDashboardUrl,
  isCloudHikeAvailable,
  type CloudHikeGrant,
} from "@/lib/cloudhike/client"
import { seal, unseal } from "@/lib/cloudhike/crypto"
import { closeAppConnection, prepareAppDatabase } from "@/lib/cloudhike/gateway"

const DEPLOY_WAIT_MS = 3 * 60_000
const DEPLOY_POLL_MS = 3_000
// An execution that stopped midway can't release its claim, so an old one doesn't hold.
const CLAIM_EXPIRES_MS = 5 * 60_000

const SETTLED = new Set(["ready", "sleeping", "paused"])

// --- The person's account ----------------------------------------------------

async function loadConnection(userId: number): Promise<CloudHikeGrant | null> {
  const [row] = await db.select().from(cloudhikeConnections).where(eq(cloudhikeConnections.userId, userId))
  if (!row) return null
  try {
    return { accessToken: unseal(row.accessToken), mcpUrl: row.mcpUrl, apiUrl: row.apiUrl }
  } catch (error) {
    // The encryption key changed, so this token is lost.
    console.error("Reading a CloudHike connection failed", error)
    return null
  }
}

export async function saveConnection(userId: number, grant: CloudHikeGrant) {
  const values = { accessToken: seal(grant.accessToken), mcpUrl: grant.mcpUrl, apiUrl: grant.apiUrl }
  await db
    .insert(cloudhikeConnections)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: cloudhikeConnections.userId, set: values })
}

// --- Status ------------------------------------------------------------------

function toStatus(row: ProjectBackend | undefined, accountConnected: boolean): BackendStatus {
  // The execution setting it up stopped midway, so nothing is going to change this.
  const abandoned = row?.state === "provisioning" && row.updatedAt.getTime() < Date.now() - CLAIM_EXPIRES_MS
  return {
    available: isCloudHikeAvailable(),
    accountConnected,
    state: abandoned ? "failed" : (row?.state ?? "disconnected"),
    services: row?.services ?? [],
    dashboardUrl: cloudhikeDashboardUrl(row?.cloudhikeProjectSlug ?? null),
    error: abandoned ? "The last setup stopped before it finished. Please try again." : (row?.error ?? null),
  }
}

export async function getBackendStatus(projectId: string, userId: number): Promise<BackendStatus> {
  const [[row], [account]] = await Promise.all([
    db.select().from(projectBackends).where(eq(projectBackends.projectId, projectId)),
    db.select({ userId: cloudhikeConnections.userId }).from(cloudhikeConnections).where(eq(cloudhikeConnections.userId, userId)),
  ])
  return toStatus(row, Boolean(account))
}

/** Makes this project use the person's connected CloudHike account. Services follow when they're needed. */
export async function linkProject(projectId: string) {
  await db
    .insert(projectBackends)
    .values({ projectId, state: "linked" })
    .onConflictDoUpdate({
      target: projectBackends.projectId,
      // A project that already runs stays that way, as connecting again only replaces the token.
      set: { state: sql`case when ${projectBackends.state} = 'ready' then 'ready'::backend_state else 'linked'::backend_state end`, error: null },
    })
}

/**
 * Stops this app using CloudHike: it goes back to saving on the device, and its
 * credentials are erased here. Nothing is deleted in CloudHike, which only its
 * dashboard can do. Without another connected app, the person's token is erased too.
 */
export async function disconnectProject(projectId: string, userId: number) {
  await db
    .update(projectBackends)
    .set({ state: "disconnected", environment: null, services: [], error: null })
    .where(eq(projectBackends.projectId, projectId))
  closeAppConnection(projectId)
  await mergePlan(projectId, { backend: null })

  const [other] = await db
    .select({ projectId: projectBackends.projectId })
    .from(projectBackends)
    .innerJoin(projects, eq(projects.id, projectBackends.projectId))
    .where(and(eq(projects.userId, userId), ne(projectBackends.state, "disconnected")))
    .limit(1)
  if (!other) await db.delete(cloudhikeConnections).where(eq(cloudhikeConnections.userId, userId))
}

// --- Deploying ---------------------------------------------------------------

/** What the app's code needs, on top of the database that everything is stored in. */
async function servicesTheCodeNeeds(projectId: string) {
  const rows = await db.select({ code: screens.code }).from(screens).where(eq(screens.projectId, projectId))
  const code = rows.map((row) => row.code ?? "").join("\n")
  const needed: BackendService[] = ["postgres"]
  if (/\buseAuth\b/.test(code)) needed.push("auth")
  if (/\buploadFile\b/.test(code)) needed.push("storage")
  return needed
}

function toAppBackend(projectId: string, services: BackendServiceStatus[], env: Record<string, string>): AppBackend {
  return {
    apiPath: `/api/apps/${projectId}`,
    authUrl: env.AUTH_URL ?? null,
    authKey: env.AUTH_PUBLISHABLE_KEY ?? null,
    services: services.map((service) => service.type),
  }
}

/** A CloudHike project's name: readable, and always the same for this app, so a retry finds it again. */
function cloudhikeProjectName(project: Project) {
  const title = (project.plan?.appName || project.title).replace(/\s+/g, " ").trim().slice(0, 30)
  return `${title} ${project.id.slice(0, 8)}`
}

export type SetUpBackendOptions = {
  /** Services asked for on top of what the app's code needs. */
  services?: BackendService[]
  /** Only true once the person has agreed to CloudHike's email policy. */
  acceptEmailPolicy?: boolean
  emit: (event: AgentEvent) => void
}

export type SetUpBackendResult =
  | { ok: true; plan: AppPlan; services: BackendServiceStatus[] }
  | { ok: false; message: string }

/**
 * Deploys what the app needs into the CloudHike project of its own and connects
 * the app to it. Safe to run any number of times. It only adds what's missing,
 * and an app already running keeps running if this fails.
 */
export async function setUpBackend(project: Project, { services = [], acceptEmailPolicy = false, emit }: SetUpBackendOptions): Promise<SetUpBackendResult> {
  const claimedAt = new Date(Date.now() - CLAIM_EXPIRES_MS)
  const [row] = await db
    .update(projectBackends)
    .set({ state: "provisioning", error: null })
    .where(
      and(
        eq(projectBackends.projectId, project.id),
        sql`(${inArray(projectBackends.state, ["linked", "ready", "failed"])} or (${eq(projectBackends.state, "provisioning")} and ${lt(projectBackends.updatedAt, claimedAt)}))`
      )
    )
    .returning()
  if (!row) return { ok: false, message: "This app's backend is already being set up, or isn't connected." }
  const wasReady = Boolean(project.plan?.backend)

  const report = async (changes: Partial<ProjectBackend>) => {
    await db.update(projectBackends).set(changes).where(eq(projectBackends.projectId, project.id))
    emit({ type: "backend", backend: await getBackendStatus(project.id, project.userId) })
  }
  emit({ type: "backend", backend: await getBackendStatus(project.id, project.userId) })

  try {
    const grant = await loadConnection(project.userId)
    if (!grant) throw new CloudHikeAuthError()
    const client = new CloudHikeClient(grant)

    let cloudhikeId = row.cloudhikeProjectId
    let slug = row.cloudhikeProjectSlug
    if (!cloudhikeId) {
      emit({ type: "status", label: "Creating your CloudHike project…" })
      const name = cloudhikeProjectName(project)
      const created = (await client.findProject(name)) ?? (await client.createProject(name))
      cloudhikeId = created.id
      slug = created.slug
      await report({ cloudhikeProjectId: cloudhikeId, cloudhikeProjectSlug: slug })
    }

    const current = await client.getProject(cloudhikeId)
    slug = current.project.slug ?? slug
    const deployed = new Set(current.services.map((service) => service.type))
    const wanted = new Set<BackendService>([...(await servicesTheCodeNeeds(project.id)), ...deployed, ...services])
    if (wanted.has("email") && !deployed.has("email") && !acceptEmailPolicy) wanted.delete("email")

    const missing = [...wanted].filter((type) => !deployed.has(type))
    if (missing.length > 0) {
      emit({ type: "status", label: "Deploying your backend services…" })
      await client.deployServices(cloudhikeId, missing, acceptEmailPolicy)
    }

    const deadline = Date.now() + DEPLOY_WAIT_MS
    let latest = current.services
    for (;;) {
      const waiting = [...wanted].filter((type) => !SETTLED.has(latest.find((service) => service.type === type)?.status ?? ""))
      const failed = latest.find((service) => wanted.has(service.type) && service.status === "failed")
      if (failed) throw new CloudHikeError(`CloudHike couldn't deploy ${failed.type}. Open the project in CloudHike for details.`)
      if (waiting.length === 0) break
      if (Date.now() > deadline) throw new CloudHikeError(`${waiting.join(", ")} is taking longer than expected to start. Try again in a minute.`)
      await new Promise((resolve) => setTimeout(resolve, DEPLOY_POLL_MS))
      latest = (await client.getProject(cloudhikeId)).services
      await report({ services: latest, cloudhikeProjectSlug: slug })
    }

    const database = latest.find((service) => service.type === "postgres")?.status
    if (database !== "ready") throw new CloudHikeError(`Your CloudHike database is ${database}. Start it again from the CloudHike dashboard, then try again.`)

    emit({ type: "status", label: "Connecting your app…" })
    const env = await client.getEnvironment(cloudhikeId)
    const [fresh] = await db.select({ plan: projects.plan }).from(projects).where(eq(projects.id, project.id))
    await prepareAppDatabase(env, fresh?.plan?.collections ?? [])

    const plan = await mergePlan(project.id, { backend: toAppBackend(project.id, latest, env) })
    await report({ state: "ready", services: latest, environment: seal(JSON.stringify(env)), cloudhikeProjectSlug: slug, error: null })
    emit({ type: "plan", plan })
    emit({ type: "status", label: null })
    return { ok: true, plan, services: latest }
  } catch (error) {
    const expired = error instanceof CloudHikeAuthError
    if (expired) await db.delete(cloudhikeConnections).where(eq(cloudhikeConnections.userId, project.userId))
    // Connection strings can appear in driver errors, so only CloudHike's own messages reach the person.
    const message = error instanceof CloudHikeError || expired ? error.message : "Something went wrong while setting up the backend. Please try again."
    if (!(error instanceof CloudHikeError)) console.error(`Setting up the backend of ${project.id} failed`, error)
    await report({ state: wasReady ? "ready" : "failed", error: message })
    emit({ type: "status", label: null })
    return { ok: false, message }
  }
}

/** Whether a finished build should bring the app's backend up to date. */
export async function isBackendLinked(project: Project) {
  const [[row], [account]] = await Promise.all([
    db.select({ state: projectBackends.state }).from(projectBackends).where(eq(projectBackends.projectId, project.id)),
    db.select({ userId: cloudhikeConnections.userId }).from(cloudhikeConnections).where(eq(cloudhikeConnections.userId, project.userId)),
  ])
  return Boolean(account && row && row.state !== "disconnected")
}
