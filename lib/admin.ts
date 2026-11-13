import { randomUUID } from "node:crypto"
import { notFound, redirect } from "next/navigation"
import { NextResponse } from "next/server"
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm"

import {
  adminAuditLog,
  appBuilds,
  builds,
  cloudhikeConnections,
  creditTransactions,
  db,
  expoConnections,
  githubConnections,
  projectAssets,
  projectBackends,
  projectGithubRepos,
  projects,
  projectShares,
  screens,
  users,
  webPublishes,
  type User,
} from "@/db"
import { failBuild } from "@/lib/agent/builds"
import { PLATFORM_LABELS, STATUS_STYLES, type ProjectPlatform, type ProjectStatus } from "@/lib/projects"
import { getCurrentUser, type SessionUser } from "@/lib/session"
import { deleteObjects } from "@/lib/storage"

export type AdminUser = SessionUser

function adminEmails() {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
}

export function isAdminEmail(email: string) {
  return adminEmails().includes(email.toLowerCase())
}

/** For pages: send unsigned people home; hide the area from everyone else. */
export async function requireAdminPage(): Promise<AdminUser> {
  const user = await getCurrentUser().catch(() => null)
  if (!user) redirect("/")
  if (!user.isAdmin) notFound()
  return user
}

/** For API routes: 401 when unsigned, 404 when signed in but not allowlisted. */
export async function requireAdminApi(): Promise<
  { user: AdminUser; failure?: undefined } | { user?: undefined; failure: NextResponse }
> {
  const user = await getCurrentUser().catch(() => null)
  if (!user) return { failure: NextResponse.json({ error: "Please sign in to continue." }, { status: 401 }) }
  if (!user.isAdmin) return { failure: NextResponse.json({ error: "Not found." }, { status: 404 }) }
  return { user }
}

function startOfUtcDay(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function daysAgoUtc(days: number) {
  const date = startOfUtcDay()
  date.setUTCDate(date.getUTCDate() - days)
  return date
}

export async function getAdminOverview() {
  const since = startOfUtcDay()
  const weekAgo = daysAgoUtc(7)

  const [
    [{ signupsToday }],
    [{ projectsToday }],
    [{ signupsWeek }],
    [{ projectsWeek }],
    creditToday,
    [{ totalUsers }],
    [{ totalProjects }],
    [{ readyProjects }],
    [{ buildingProjects }],
    [{ proSubscribers }],
    [{ cancelingPro }],
    [{ publicApps }],
    [{ activeBuilds }],
    [{ failedProjects }],
    [{ nativeInFlight }],
    recentSignups,
    recentFailed,
    activeBuildRows,
    recentAudit,
  ] = await Promise.all([
    db.select({ signupsToday: count() }).from(users).where(gte(users.createdAt, since)),
    db.select({ projectsToday: count() }).from(projects).where(gte(projects.createdAt, since)),
    db.select({ signupsWeek: count() }).from(users).where(gte(users.createdAt, weekAgo)),
    db.select({ projectsWeek: count() }).from(projects).where(gte(projects.createdAt, weekAgo)),
    db
      .select({
        spent: sql<number>`coalesce(sum(case when ${creditTransactions.amount} < 0 then -${creditTransactions.amount} else 0 end), 0)::int`,
        refunded: sql<number>`coalesce(sum(case when ${creditTransactions.reason} = 'refund' then ${creditTransactions.amount} else 0 end), 0)::int`,
        granted: sql<number>`coalesce(sum(case when ${creditTransactions.reason} = 'admin' and ${creditTransactions.amount} > 0 then ${creditTransactions.amount} else 0 end), 0)::int`,
      })
      .from(creditTransactions)
      .where(gte(creditTransactions.createdAt, since)),
    db.select({ totalUsers: count() }).from(users),
    db.select({ totalProjects: count() }).from(projects),
    db.select({ readyProjects: count() }).from(projects).where(eq(projects.status, "ready")),
    db.select({ buildingProjects: count() }).from(projects).where(eq(projects.status, "building")),
    db.select({ proSubscribers: count() }).from(users).where(eq(users.plan, "pro")),
    db
      .select({ cancelingPro: count() })
      .from(users)
      .where(and(eq(users.plan, "pro"), eq(users.cancelAtPeriodEnd, true))),
    db.select({ publicApps: count() }).from(projects).where(eq(projects.isPublic, true)),
    db.select({ activeBuilds: count() }).from(builds).where(eq(builds.status, "active")),
    db.select({ failedProjects: count() }).from(projects).where(eq(projects.status, "failed")),
    db
      .select({ nativeInFlight: count() })
      .from(appBuilds)
      .where(inArray(appBuilds.status, ["queued", "building"])),
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        plan: users.plan,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt))
      .limit(8),
    db
      .select({
        id: projects.id,
        title: projects.title,
        updatedAt: projects.updatedAt,
        ownerEmail: users.email,
      })
      .from(projects)
      .innerJoin(users, eq(users.id, projects.userId))
      .where(eq(projects.status, "failed"))
      .orderBy(desc(projects.updatedAt))
      .limit(6),
    db
      .select({
        id: builds.id,
        projectId: builds.projectId,
        step: builds.step,
        jobId: builds.jobId,
        createdAt: builds.createdAt,
        updatedAt: builds.updatedAt,
        title: projects.title,
        ownerEmail: users.email,
      })
      .from(builds)
      .innerJoin(projects, eq(projects.id, builds.projectId))
      .innerJoin(users, eq(users.id, projects.userId))
      .where(eq(builds.status, "active"))
      .orderBy(asc(builds.createdAt))
      .limit(6),
    db
      .select({
        id: adminAuditLog.id,
        action: adminAuditLog.action,
        detail: adminAuditLog.detail,
        targetUserId: adminAuditLog.targetUserId,
        targetProjectId: adminAuditLog.targetProjectId,
        createdAt: adminAuditLog.createdAt,
        adminEmail: users.email,
      })
      .from(adminAuditLog)
      .innerJoin(users, eq(users.id, adminAuditLog.adminUserId))
      .orderBy(desc(adminAuditLog.createdAt))
      .limit(8),
  ])

  return {
    signupsToday,
    projectsToday,
    signupsWeek,
    projectsWeek,
    creditsSpentToday: creditToday[0]?.spent ?? 0,
    creditsRefundedToday: creditToday[0]?.refunded ?? 0,
    creditsGrantedToday: creditToday[0]?.granted ?? 0,
    totalUsers,
    totalProjects,
    readyProjects,
    buildingProjects,
    proSubscribers,
    cancelingPro,
    publicApps,
    activeBuilds,
    failedProjects,
    nativeInFlight,
    recentSignups,
    recentFailed,
    activeBuildRows,
    recentAudit,
  }
}

export async function searchAdminUsers(query: string | null) {
  const q = query?.trim()
  const where = q
    ? or(ilike(users.email, `%${q}%`), ilike(users.name, `%${q}%`))
    : undefined

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      plan: users.plan,
      credits: users.credits,
      monthlyCredits: users.monthlyCredits,
      currentPeriodEnd: users.currentPeriodEnd,
      cancelAtPeriodEnd: users.cancelAtPeriodEnd,
      createdAt: users.createdAt,
      projectCount: sql<number>`coalesce(count(${projects.id}), 0)::int`,
    })
    .from(users)
    .leftJoin(projects, eq(projects.userId, users.id))
    .where(where)
    .groupBy(users.id)
    .orderBy(desc(users.createdAt))
    .limit(100)

  return rows
}

export async function getAdminUser(userId: number) {
  const [user] = await db.select().from(users).where(eq(users.id, userId))
  if (!user) return null

  const [[{ projectCount }], github, expo, cloudhike, ledger] = await Promise.all([
    db.select({ projectCount: count() }).from(projects).where(eq(projects.userId, userId)),
    db.select({ userId: githubConnections.userId }).from(githubConnections).where(eq(githubConnections.userId, userId)).limit(1),
    db.select({ userId: expoConnections.userId }).from(expoConnections).where(eq(expoConnections.userId, userId)).limit(1),
    db
      .select({ userId: cloudhikeConnections.userId })
      .from(cloudhikeConnections)
      .where(eq(cloudhikeConnections.userId, userId))
      .limit(1),
    db
      .select({
        id: creditTransactions.id,
        amount: creditTransactions.amount,
        balanceAfter: creditTransactions.balanceAfter,
        reason: creditTransactions.reason,
        reference: creditTransactions.reference,
        projectId: creditTransactions.projectId,
        createdAt: creditTransactions.createdAt,
      })
      .from(creditTransactions)
      .where(eq(creditTransactions.userId, userId))
      .orderBy(desc(creditTransactions.createdAt))
      .limit(50),
  ])

  const ownedProjects = await db
    .select({
      id: projects.id,
      title: projects.title,
      status: projects.status,
      platform: projects.platform,
      isPublic: projects.isPublic,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.updatedAt))
    .limit(50)

  return {
    user,
    projectCount,
    connections: {
      github: github.length > 0,
      expo: expo.length > 0,
      cloudhike: cloudhike.length > 0,
    },
    ledger,
    projects: ownedProjects,
  }
}

type ProjectFilters = {
  status?: ProjectStatus | null
  platform?: ProjectPlatform | null
  isPublic?: boolean | null
  owner?: string | null
}

export async function searchAdminProjects(filters: ProjectFilters) {
  const conditions: SQL[] = []
  if (filters.status) conditions.push(eq(projects.status, filters.status))
  if (filters.platform) conditions.push(eq(projects.platform, filters.platform))
  if (typeof filters.isPublic === "boolean") conditions.push(eq(projects.isPublic, filters.isPublic))
  if (filters.owner?.trim()) {
    const owner = filters.owner.trim()
    conditions.push(or(ilike(users.email, `%${owner}%`), ilike(users.name, `%${owner}%`))!)
  }

  const rows = await db
    .select({
      id: projects.id,
      title: projects.title,
      status: projects.status,
      platform: projects.platform,
      isPublic: projects.isPublic,
      prompt: projects.prompt,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      ownerId: users.id,
      ownerEmail: users.email,
      ownerName: users.name,
    })
    .from(projects)
    .innerJoin(users, eq(users.id, projects.userId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(projects.updatedAt))
    .limit(100)

  return rows
}

export async function getAdminProject(projectId: string) {
  const [row] = await db
    .select({
      project: projects,
      ownerEmail: users.email,
      ownerName: users.name,
      ownerId: users.id,
    })
    .from(projects)
    .innerJoin(users, eq(users.id, projects.userId))
    .where(eq(projects.id, projectId))
  if (!row) return null

  const [screenRows, [{ shareCount }], backend, github, publish, web, active] = await Promise.all([
    db
      .select({
        id: screens.id,
        slug: screens.slug,
        name: screens.name,
        position: screens.position,
        status: screens.status,
        hasCode: sql<boolean>`${screens.code} is not null`,
      })
      .from(screens)
      .where(eq(screens.projectId, projectId))
      .orderBy(asc(screens.position)),
    db.select({ shareCount: count() }).from(projectShares).where(eq(projectShares.projectId, projectId)),
    db.select().from(projectBackends).where(eq(projectBackends.projectId, projectId)).limit(1),
    db
      .select({ owner: projectGithubRepos.owner, name: projectGithubRepos.name })
      .from(projectGithubRepos)
      .where(eq(projectGithubRepos.projectId, projectId))
      .limit(1),
    db.select().from(appBuilds).where(eq(appBuilds.projectId, projectId)).orderBy(desc(appBuilds.createdAt)).limit(5),
    db.select().from(webPublishes).where(eq(webPublishes.projectId, projectId)).limit(1),
    db.select().from(builds).where(and(eq(builds.projectId, projectId), eq(builds.status, "active"))).limit(1),
  ])

  return {
    ...row,
    screens: screenRows,
    shareCount,
    backend: backend[0] ?? null,
    github: github[0] ?? null,
    appBuilds: publish,
    webPublish: web[0] ?? null,
    activeBuild: active[0] ?? null,
  }
}

export async function listPublicAdminProjects() {
  return db
    .select({
      id: projects.id,
      title: projects.title,
      prompt: projects.prompt,
      ownerEmail: users.email,
      ownerName: users.name,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .innerJoin(users, eq(users.id, projects.userId))
    .where(and(eq(projects.isPublic, true), eq(projects.status, "ready")))
    .orderBy(desc(projects.updatedAt))
    .limit(100)
}

export async function getAdminBuilds() {
  const [active, failed, native, web] = await Promise.all([
    db
      .select({
        id: builds.id,
        projectId: builds.projectId,
        jobId: builds.jobId,
        step: builds.step,
        creditsCharged: builds.creditsCharged,
        createdAt: builds.createdAt,
        updatedAt: builds.updatedAt,
        title: projects.title,
        ownerEmail: users.email,
      })
      .from(builds)
      .innerJoin(projects, eq(projects.id, builds.projectId))
      .innerJoin(users, eq(users.id, projects.userId))
      .where(eq(builds.status, "active"))
      .orderBy(asc(builds.createdAt))
      .limit(50),
    db
      .select({
        id: projects.id,
        title: projects.title,
        updatedAt: projects.updatedAt,
        ownerEmail: users.email,
      })
      .from(projects)
      .innerJoin(users, eq(users.id, projects.userId))
      .where(eq(projects.status, "failed"))
      .orderBy(desc(projects.updatedAt))
      .limit(30),
    db
      .select({
        id: appBuilds.id,
        projectId: appBuilds.projectId,
        platform: appBuilds.platform,
        format: appBuilds.format,
        status: appBuilds.status,
        version: appBuilds.version,
        error: appBuilds.error,
        createdAt: appBuilds.createdAt,
        title: projects.title,
        ownerEmail: users.email,
      })
      .from(appBuilds)
      .innerJoin(projects, eq(projects.id, appBuilds.projectId))
      .innerJoin(users, eq(users.id, projects.userId))
      .where(inArray(appBuilds.status, ["queued", "building", "failed"]))
      .orderBy(desc(appBuilds.createdAt))
      .limit(40),
    db
      .select({
        projectId: webPublishes.projectId,
        status: webPublishes.status,
        liveUrl: webPublishes.liveUrl,
        error: webPublishes.error,
        startedAt: webPublishes.startedAt,
        publishedAt: webPublishes.publishedAt,
        title: projects.title,
        ownerEmail: users.email,
      })
      .from(webPublishes)
      .innerJoin(projects, eq(projects.id, webPublishes.projectId))
      .innerJoin(users, eq(users.id, projects.userId))
      .orderBy(desc(webPublishes.updatedAt))
      .limit(40),
  ])

  return { active, failed, native, web }
}

/**
 * Adjusts the non-expiring credit pool and writes an audit row.
 * Positive `amount` grants; negative deducts. Uses `admin:<auditId>` so a retry can't apply twice.
 */
export async function adminAdjustCredits(
  admin: Pick<User, "id">,
  targetUserId: number,
  amount: number,
  note: string
) {
  if (!Number.isInteger(amount) || amount === 0) {
    throw new AdminActionError("Enter a non-zero whole number of credits.")
  }

  return db.transaction(async (tx) => {
    const [target] = await tx.select().from(users).where(eq(users.id, targetUserId)).for("update")
    if (!target) throw new AdminActionError("User not found.", 404)

    if (amount < 0 && target.credits < -amount) {
      throw new AdminActionError(`They only have ${target.credits} non-expiring credits.`)
    }

    const auditId = randomUUID()
    await tx.insert(adminAuditLog).values({
      id: auditId,
      adminUserId: admin.id,
      action: "grant-credits",
      targetUserId,
      detail: { amount, note: note.trim() || null, email: target.email },
    })

    const nextCredits = target.credits + amount
    const saved = await tx
      .insert(creditTransactions)
      .values({
        userId: targetUserId,
        amount,
        balanceAfter: nextCredits + target.monthlyCredits,
        reason: "admin",
        reference: `admin:${auditId}`,
      })
      .onConflictDoNothing()
      .returning({ id: creditTransactions.id })

    if (saved.length === 0) {
      return { credits: target.credits, monthlyCredits: target.monthlyCredits, applied: false }
    }

    await tx.update(users).set({ credits: nextCredits }).where(eq(users.id, targetUserId))
    return { credits: nextCredits, monthlyCredits: target.monthlyCredits, applied: true }
  })
}

export async function adminSetPublic(admin: Pick<User, "id">, projectId: string, isPublic: boolean) {
  return db.transaction(async (tx) => {
    const [project] = await tx.select().from(projects).where(eq(projects.id, projectId)).for("update")
    if (!project) throw new AdminActionError("Project not found.", 404)

    if (isPublic) {
      const [built] = await tx
        .select({ id: screens.id })
        .from(screens)
        .where(and(eq(screens.projectId, projectId), isNotNull(screens.code)))
        .limit(1)
      if (!built) throw new AdminActionError("Build the app before making it public.", 409)
    }

    await tx
      .update(projects)
      .set({ isPublic, updatedAt: project.updatedAt })
      .where(eq(projects.id, projectId))

    await tx.insert(adminAuditLog).values({
      adminUserId: admin.id,
      action: "set-public",
      targetUserId: project.userId,
      targetProjectId: projectId,
      detail: { isPublic, title: project.title },
    })

    return { isPublic }
  })
}

export async function adminFailBuild(admin: Pick<User, "id">, buildId: string) {
  const [build] = await db
    .select({
      id: builds.id,
      status: builds.status,
      projectId: builds.projectId,
      userId: projects.userId,
      title: projects.title,
    })
    .from(builds)
    .innerJoin(projects, eq(projects.id, builds.projectId))
    .where(eq(builds.id, buildId))
  if (!build) throw new AdminActionError("Build not found.", 404)
  if (build.status !== "active") throw new AdminActionError("That build is no longer active.", 409)

  await failBuild(buildId, "Stopped by an admin.")
  const [after] = await db.select({ status: builds.status }).from(builds).where(eq(builds.id, buildId))
  if (after?.status === "active") {
    throw new AdminActionError("Couldn't stop the build. Try again in a moment.", 409)
  }

  await db.insert(adminAuditLog).values({
    adminUserId: admin.id,
    action: "fail-build",
    targetUserId: build.userId,
    targetProjectId: build.projectId,
    detail: { buildId, title: build.title },
  })
  return { ok: true as const }
}

export async function adminDeleteProject(admin: Pick<User, "id">, projectId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId))
  if (!project) throw new AdminActionError("Project not found.", 404)

  const [active] = await db
    .select({ id: builds.id })
    .from(builds)
    .where(and(eq(builds.projectId, projectId), eq(builds.status, "active")))
    .limit(1)
  if (active) await failBuild(active.id, "Stopped by an admin before delete.")

  const assets = await db
    .select({ storageKey: projectAssets.storageKey })
    .from(projectAssets)
    .where(eq(projectAssets.projectId, projectId))

  await db.insert(adminAuditLog).values({
    adminUserId: admin.id,
    action: "delete-project",
    targetUserId: project.userId,
    targetProjectId: projectId,
    detail: { title: project.title, status: project.status },
  })

  await db.delete(projects).where(eq(projects.id, projectId))
  await deleteObjects(assets.map((asset) => asset.storageKey)).catch((cause) => {
    console.error("Deleting a project's files failed", cause)
  })

  return { ok: true as const }
}

export class AdminActionError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message)
  }
}

export function adminActionResponse(error: unknown) {
  if (error instanceof AdminActionError) {
    return NextResponse.json({ error: error.message }, { status: error.status })
  }
  console.error("Admin action failed", error)
  return NextResponse.json({ error: "Something went wrong on our side. Please try again." }, { status: 500 })
}

export { PLATFORM_LABELS, STATUS_STYLES }
