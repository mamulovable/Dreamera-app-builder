import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import { and, count, eq, sql } from "drizzle-orm"

import { builds, creditTransactions, db, projects, screens, users, type Project } from "@/db"
import type { AppPlan } from "@/lib/agent-protocol"
import { EDIT_CREDITS, PLANS, PRO_MONTHLY_CREDITS, buildCost, type CreditReason, type PlanId, type UpgradeReason } from "@/lib/plans"

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** A plan limit stopped this, and the browser shows an upgrade prompt for `reason`. */
export class PlanLimitError extends Error {
  constructor(
    readonly reason: UpgradeReason,
    message: string,
    readonly status = 403
  ) {
    super(message)
  }
}

export function planLimitResponse(error: PlanLimitError) {
  return NextResponse.json({ error: error.message, code: error.reason }, { status: error.status })
}

function notEnoughCredits(needed: number) {
  return new PlanLimitError("credits", `This needs ${needed} credits, and you don't have enough left.`, 402)
}

function projectLimitReached(maxProjects: number) {
  return new PlanLimitError("projects", `The Free plan includes ${maxProjects} projects. Upgrade to Pro for unlimited projects, or delete one to make room.`)
}

export function screenLimitMessage(plan: PlanId) {
  return `The ${PLANS[plan].name} plan allows ${PLANS[plan].maxScreens} screens per project.`
}

/** Stops a chat with the agent, or a new project, that no change could come out of. */
export function assertCanUseAgent(credits: number) {
  if (credits < EDIT_CREDITS) throw notEnoughCredits(EDIT_CREDITS)
}

/** Takes `amount`, this month's credits first, or throws without taking any. */
export async function spendCredits(
  userId: number,
  amount: number,
  entry: { reason: CreditReason; projectId: string; reference: string }
) {
  await db.transaction(async (tx) => {
    // The row is checked and changed in one statement, so spending at once from two tabs can't go below zero.
    const [user] = await tx
      .update(users)
      .set({
        monthlyCredits: sql`${users.monthlyCredits} - least(${users.monthlyCredits}, ${amount}::int)`,
        credits: sql`${users.credits} - greatest(${amount}::int - ${users.monthlyCredits}, 0)`,
      })
      .where(and(eq(users.id, userId), sql`${users.credits} + ${users.monthlyCredits} >= ${amount}::int`))
      .returning({ credits: users.credits, monthlyCredits: users.monthlyCredits })
    if (!user) throw notEnoughCredits(amount)
    await tx.insert(creditTransactions).values({
      ...entry,
      userId,
      amount: -amount,
      balanceAfter: user.credits + user.monthlyCredits,
    })
  })
}

/**
 * Gives credits back once per `reference`, as credits that don't expire, since
 * the month they came from may be over by now. Returns whether it did.
 */
export async function refundCredits(userId: number, amount: number, entry: { projectId: string; reference: string }) {
  if (amount <= 0) return false
  return db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update")
    const saved = await tx
      .insert(creditTransactions)
      .values({ ...entry, userId, amount, balanceAfter: user.credits + user.monthlyCredits + amount, reason: "refund" })
      .onConflictDoNothing()
      .returning({ id: creditTransactions.id })
    if (saved.length === 0) return false
    await tx.update(users).set({ credits: user.credits + amount }).where(eq(users.id, userId))
    return true
  })
}

export type BuildCharge = { id: string; credits: number }

/** Charges for what a build of `plan` still has to do, before anything about the build is saved. */
export async function chargeForBuild(project: Pick<Project, "id" | "userId">, plan: AppPlan, userPlan: PlanId): Promise<BuildCharge> {
  const rows = await db.select({ slug: screens.slug, code: screens.code }).from(screens).where(eq(screens.projectId, project.id))
  // Someone who has downgraded keeps a bigger app they've built, but can't build more of it.
  const hasUnbuilt = plan.screens.some((screen) => !rows.some((row) => row.slug === screen.id && row.code))
  if (hasUnbuilt && plan.screens.length > PLANS[userPlan].maxScreens) {
    throw new PlanLimitError("screens", `${screenLimitMessage(userPlan)} Upgrade to Pro to build this one, or remove some screens.`)
  }

  const id = randomUUID()
  const credits = buildCost(plan, rows)
  if (credits > 0) {
    await spendCredits(project.userId, credits, {
      reason: plan.pendingChanges ? "edit" : "build",
      projectId: project.id,
      reference: `build:${id}`,
    })
  }
  return { id, credits }
}

/** Gives back a charge whose build never started. */
export function refundCharge(project: Pick<Project, "id" | "userId">, charge: BuildCharge) {
  return refundCredits(project.userId, charge.credits, { projectId: project.id, reference: `refund:${charge.id}` })
}

/**
 * Gives back what a failed build was charged for and didn't finish, which trying
 * again charges again. Safe to call twice. Returns how much came back.
 */
export async function refundUnfinishedBuild(buildId: string) {
  const [build] = await db
    .select({ charged: builds.creditsCharged, project: projects })
    .from(builds)
    .innerJoin(projects, eq(projects.id, builds.projectId))
    .where(eq(builds.id, buildId))
  if (!build?.charged || !build.project.plan) return 0

  const rows = await db.select({ slug: screens.slug, code: screens.code }).from(screens).where(eq(screens.projectId, build.project.id))
  const amount = Math.min(build.charged, buildCost(build.project.plan, rows))
  const refunded = await refundCredits(build.project.userId, amount, { projectId: build.project.id, reference: `refund:${buildId}` })
  return refunded ? amount : 0
}

export async function hasProjectSlot(userId: number, plan: PlanId) {
  const maxProjects = PLANS[plan].maxProjects
  if (maxProjects === null) return true
  const [{ owned }] = await db.select({ owned: count() }).from(projects).where(eq(projects.userId, userId))
  return owned < maxProjects
}

export function assertProjectSlot(hasSlot: boolean, plan: PlanId) {
  const maxProjects = PLANS[plan].maxProjects
  if (!hasSlot && maxProjects !== null) throw projectLimitReached(maxProjects)
}

/** Checks for room again inside the transaction creating a project. The lock makes two requests at once take turns. */
export async function claimProjectSlot(tx: Transaction, userId: number) {
  const [owner] = await tx.select({ plan: users.plan }).from(users).where(eq(users.id, userId)).for("update")
  const maxProjects = PLANS[owner.plan].maxProjects
  if (maxProjects === null) return
  const [{ owned }] = await tx.select({ owned: count() }).from(projects).where(eq(projects.userId, userId))
  if (owned >= maxProjects) throw projectLimitReached(maxProjects)
}

/** Replaces what's left of the last period's credits with a new month's. Once per `reference`, the paid invoice. */
export async function grantMonthlyCredits(userId: number, reference: string) {
  await db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update")
    const saved = await tx
      .insert(creditTransactions)
      .values({
        userId,
        amount: PRO_MONTHLY_CREDITS - user.monthlyCredits,
        balanceAfter: user.credits + PRO_MONTHLY_CREDITS,
        reason: "renewal",
        reference,
      })
      .onConflictDoNothing()
      .returning({ id: creditTransactions.id })
    if (saved.length > 0) await tx.update(users).set({ monthlyCredits: PRO_MONTHLY_CREDITS }).where(eq(users.id, userId))
  })
}

/** Puts someone on Free. This month's credits go with Pro, and what never expires stays. */
export async function endProPlan(userId: number, reference: string) {
  await db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for("update")
    await tx
      .update(users)
      .set({ plan: "free", monthlyCredits: 0, stripeSubscriptionId: null, currentPeriodEnd: null, cancelAtPeriodEnd: false })
      .where(eq(users.id, userId))
    if (user.monthlyCredits === 0) return
    await tx
      .insert(creditTransactions)
      .values({ userId, amount: -user.monthlyCredits, balanceAfter: user.credits, reason: "plan-ended", reference })
      .onConflictDoNothing()
  })
}
