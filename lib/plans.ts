// Plan rules shared by the pricing page and upgrade prompts (client) and the limits they enforce (server).

import type { AppPlan } from "@/lib/agent-protocol"

export const PLAN_IDS = ["free", "pro"] as const
export type PlanId = (typeof PLAN_IDS)[number]

/** One-time and never expire. */
export const FREE_SIGNUP_CREDITS = 100
/** Replaces what's left of the last month's at each renewal. */
export const PRO_MONTHLY_CREDITS = 1000

// A small app is 4 screens, so 40 credits. Free's 100 is then about 2 apps and 4 edits, and Pro's 1,000 about 25 apps or 200 edits.
export const SCREEN_CREDITS = 10
export const EDIT_CREDITS = 5
export const IMAGE_CREDITS = 1
export const SMALL_APP_CREDITS = 4 * SCREEN_CREDITS

export const PLANS: Record<PlanId, { name: string; maxProjects: number | null; maxScreens: number; nativePublish: boolean }> = {
  free: { name: "Free", maxProjects: 2, maxScreens: 5, nativePublish: false },
  pro: { name: "Pro", maxProjects: null, maxScreens: 10, nativePublish: true },
}

/** Shown on the pricing page. Keep it the same as the Stripe price in `STRIPE_PRO_PRICE_ID`. */
export const PRO_PRICE_LABEL = process.env.NEXT_PUBLIC_PRO_PRICE_LABEL || "$20"

/** A limit the person ran into, which an upgrade prompt explains. API errors carry it as `code`. */
export const UPGRADE_REASONS = ["projects", "screens", "credits", "native-publish"] as const
export type UpgradeReason = (typeof UPGRADE_REASONS)[number]

export function isUpgradeReason(value: unknown): value is UpgradeReason {
  return UPGRADE_REASONS.includes(value as UpgradeReason)
}

export const CREDIT_REASONS = ["build", "edit", "image", "refund", "renewal", "plan-ended"] as const
export type CreditReason = (typeof CREDIT_REASONS)[number]

/**
 * What a build of `plan` costs: each screen with no code yet, and the round of changes if it's one.
 * What a failed build didn't finish is refunded by this same sum, and trying again charges it again.
 */
export function buildCost(plan: Pick<AppPlan, "screens" | "pendingChanges">, rows: { slug: string; code: string | null }[]) {
  const unbuilt = plan.screens.filter((screen) => !rows.some((row) => row.slug === screen.id && row.code)).length
  return unbuilt * SCREEN_CREDITS + (plan.pendingChanges ? EDIT_CREDITS : 0)
}
