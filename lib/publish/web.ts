// Publishes generated apps as websites. As with native builds nothing is built here: EAS exports
// the app and deploys it to EAS Hosting, and this reads how it's going whenever someone looks. Server only.

import { and, eq, inArray, notInArray } from "drizzle-orm"

import { db, projectPublishing, webPublishes, type Project, type WebPublish } from "@/db"
import { unseal } from "@/lib/cloudhike/crypto"
import { EAS_JSON, webWorkflow } from "@/lib/generated-app/build-files"
import {
  CHECK_EVERY_MS,
  NEVER_STARTED_AFTER_MS,
  PublishBlockedError,
  ensureIdentity,
  isPublishAvailable,
  loadExpoConnection,
  withProjectId,
} from "@/lib/publish/builds"
import { ExpoError, ensureExpoApp, ensureWebDomain, hasReachedDeployStep, readWebRun, startWorkflowRun, type WebRunState } from "@/lib/publish/expo"
import { projectTarball } from "@/lib/publish/tarball"
import { WEB_PUBLISH_STATUSES, isWebPublishActive, type WebPublishStatus, type WebPublishSummary } from "@/lib/publish-protocol"
import { ExportUnavailableError, loadProjectExport } from "@/lib/project-access"

const ACTIVE_STATUSES: WebPublishStatus[] = WEB_PUBLISH_STATUSES.filter(isWebPublishActive)

/** Only an address on Expo's own domain ever reaches a link in the workspace. */
const EXPO_SITE = /^https:\/\/[a-z0-9-]+\.expo\.app\/?$/

function toSummary(row: WebPublish): WebPublishSummary {
  return {
    status: row.status,
    url: row.liveUrl,
    error: row.error,
    publishedAt: row.publishedAt?.toISOString() ?? null,
  }
}

type WebReport =
  | { status: "queued" | "building" | "deploying" }
  | { status: "published"; url: string | null }
  | { status: "failed"; error: string }

/** Only ever moves the publish that's running. A newer publish, or one that has finished, isn't touched. */
async function recordPublish(row: WebPublish, report: WebReport) {
  const published = report.status === "published"
  await db
    .update(webPublishes)
    .set({
      status: report.status,
      ...(published ? { liveUrl: report.url ?? row.targetUrl, publishedAt: new Date(), error: null } : {}),
      ...(report.status === "failed" ? { error: report.error } : {}),
    })
    .where(
      and(
        eq(webPublishes.projectId, row.projectId),
        inArray(webPublishes.status, ACTIVE_STATUSES),
        eq(webPublishes.startedAt, row.startedAt)
      )
    )
}

async function reportFromRun(run: WebRunState, current: WebPublishStatus): Promise<WebReport> {
  const job = run.jobs.find((candidate) => candidate.type === "DEPLOY") ?? run.jobs[0]
  if (run.status === "SUCCESS") {
    const url = job?.outputs?.deploy_url
    return { status: "published", url: typeof url === "string" && EXPO_SITE.test(url) ? url : null }
  }
  if (run.status === "CANCELED") return { status: "failed", error: "The publish was cancelled on Expo." }
  if (run.status === "FAILURE") {
    const detail = [...(job?.errors ?? []), ...run.errors].find((error) => error.message)
    return { status: "failed", error: detail?.message ?? "EAS couldn't publish the website." }
  }
  if (job?.status !== "IN_PROGRESS") return { status: "queued" }
  const log = job.turtleJobRun?.logFileUrls[0]
  // The log is only read until it has said so, and the step never goes backwards.
  const deploying = current === "deploying" || (log ? await hasReachedDeployStep(log) : false)
  return { status: deploying ? "deploying" : "building" }
}

/** The server holds the status, and it's brought up to date here, so nothing depends on a tab staying open. */
async function refreshWebPublish(row: WebPublish, userId: number) {
  if (!isWebPublishActive(row.status) || Date.now() - row.updatedAt.getTime() < CHECK_EVERY_MS) return
  if (!row.easRunId) {
    if (Date.now() - row.startedAt.getTime() > NEVER_STARTED_AFTER_MS) {
      await recordPublish(row, { status: "failed", error: "This publish never reached Expo. Please try again." })
    }
    return
  }
  const expo = await loadExpoConnection(userId)
  if (!expo) {
    await recordPublish(row, { status: "failed", error: "Expo was disconnected, so AppForge can't follow this publish. It may still finish on expo.dev." })
    return
  }
  try {
    await recordPublish(row, await reportFromRun(await readWebRun(unseal(expo.accessToken), row.easRunId), row.status))
  } catch (cause) {
    if (cause instanceof ExpoError && cause.unauthorized) {
      await recordPublish(row, { status: "failed", error: "Expo stopped accepting your token, so AppForge can't follow this publish. It may still finish on expo.dev." })
    } else {
      // Only the network, most likely. The next look tries again.
      console.error(`Checking on the website of project ${row.projectId} failed`, cause)
    }
  }
}

async function loadWebPublish(projectId: string) {
  const [row] = await db.select().from(webPublishes).where(eq(webPublishes.projectId, projectId))
  return row ?? null
}

/** Null until the project's first publish. */
export async function getWebPublish(projectId: string, userId: number) {
  const row = await loadWebPublish(projectId)
  if (!row) return null
  await refreshWebPublish(row, userId)
  return toSummary((await loadWebPublish(projectId)) ?? row)
}

function friendlyStartError(cause: unknown) {
  if (cause instanceof ExpoError || cause instanceof ExportUnavailableError) return cause.message
  return "We couldn't start publishing. Please try again."
}

/** Sends the app to EAS and starts the deploy. It doesn't wait for the deploy. */
async function sendToExpo(project: Project, expoToken: string, easOwner: string) {
  // The version belongs to the store builds, and a website doesn't change it.
  const [existing] = await db.select({ version: projectPublishing.version }).from(projectPublishing).where(eq(projectPublishing.projectId, project.id))
  const identity = await ensureIdentity(project, easOwner, existing?.version ?? "1.0.0")
  const { appId, accountId } = await ensureExpoApp(expoToken, identity.easOwner, identity.slug)
  const domain = await ensureWebDomain(expoToken, appId)

  // Loaded after the identity is saved, so the files carry it.
  const { files } = await loadProjectExport(project)
  const packageJson = files.find(({ path }) => path === "package.json")?.content ?? ""
  const tarball = projectTarball(files.map((file) => (file.path === "app.json" ? { ...file, content: withProjectId(file.content, appId) } : file)))
  const easRunId = await startWorkflowRun(expoToken, { appId, accountId, workflow: webWorkflow(), tarball, easJson: EAS_JSON, packageJson })
  return { easRunId, targetUrl: `https://${domain}.expo.app` }
}

/** Publishes the project's website, or updates it if it has one. Returns as soon as Expo has the app. */
export async function startWebPublish(project: Project, userId: number): Promise<WebPublishSummary> {
  if (!isPublishAvailable()) throw new PublishBlockedError("Publishing isn't set up on this AppForge server yet.")

  const expo = await loadExpoConnection(userId)
  if (!expo) throw new PublishBlockedError("Connect your Expo account first.", "expo")

  // Finds problems the person can fix, such as the agent still working, before a publish exists to fail.
  await loadProjectExport(project)

  // A publish whose request died shouldn't hold up this one.
  const previous = await loadWebPublish(project.id)
  if (previous) await refreshWebPublish(previous, userId)

  const startedAt = new Date()
  const values = { status: "uploading" as const, easRunId: null, error: null, startedAt, updatedAt: startedAt }
  const [row] = await db
    .insert(webPublishes)
    .values({ projectId: project.id, ...values })
    .onConflictDoUpdate({ target: webPublishes.projectId, set: values, setWhere: notInArray(webPublishes.status, ACTIVE_STATUSES) })
    .returning()
  if (!row) throw new PublishBlockedError("This app is already being published. Wait for it to finish first.", undefined, 409)

  try {
    const { easRunId, targetUrl } = await sendToExpo(project, unseal(expo.accessToken), expo.accountName)
    const [started] = await db
      .update(webPublishes)
      .set({ easRunId, targetUrl, status: "queued" })
      .where(eq(webPublishes.projectId, project.id))
      .returning()
    return toSummary(started)
  } catch (cause) {
    console.error(`Publishing the website of project ${project.id} failed`, cause)
    await recordPublish(row, { status: "failed", error: friendlyStartError(cause) })
    return toSummary((await loadWebPublish(project.id)) ?? row)
  }
}
