import { cookies } from "next/headers"
import { eq } from "drizzle-orm"

import { db, users, type User } from "@/db"
import { getAuthSession, type AuthUser } from "@/lib/cloudhike-auth"
import type { PlanId } from "@/lib/plans"

export const SESSION_COOKIE = "appforge_session"
export const OAUTH_STATE_COOKIE = "appforge_oauth_state"
const SESSION_MAX_AGE = 60 * 60 * 24 * 7 // 7 days

export async function setSessionCookie(token: string) {
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  })
}

export async function clearSessionCookie() {
  const store = await cookies()
  store.delete(SESSION_COOKIE)
}

export async function getSessionToken() {
  const store = await cookies()
  return store.get(SESSION_COOKIE)?.value ?? null
}

/**
 * Returns the app's record for an authenticated user, creating it on first sight.
 * Free credits come from the column default, so they're only granted when the
 * row is inserted — signing in again never adds more.
 */
export async function ensureUser(authUser: AuthUser): Promise<User> {
  const [created] = await db
    .insert(users)
    .values({
      authUserId: authUser.id,
      name: authUser.name,
      email: authUser.email.toLowerCase(),
    })
    .onConflictDoNothing()
    .returning()
  if (created) return created

  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.authUserId, authUser.id))
  if (existing) return existing

  // Same email under a new auth account (e.g. it was deleted and recreated):
  // relink the existing row instead of granting a second set of credits.
  const [relinked] = await db
    .update(users)
    .set({ authUserId: authUser.id, name: authUser.name })
    .where(eq(users.email, authUser.email.toLowerCase()))
    .returning()
  return relinked
}

export type SessionUser = {
  id: number
  name: string
  email: string
  image: string | null
  /** Everything they can spend: what never expires and this month's Pro credits. */
  credits: number
  monthlyCredits: number
  plan: PlanId
  /** When Pro renews, or ends if `cancelAtPeriodEnd`. */
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
}

export function toSessionUser(user: User, authUser: AuthUser): SessionUser {
  return {
    id: user.id,
    name: user.name ?? authUser.name,
    email: user.email,
    image: authUser.image ?? null,
    credits: user.credits + user.monthlyCredits,
    monthlyCredits: user.monthlyCredits,
    plan: user.plan,
    currentPeriodEnd: user.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: user.cancelAtPeriodEnd,
  }
}

/** The signed-in user for the current request, or null. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = await getSessionToken()
  if (!token) return null

  const session = await getAuthSession(token).catch(() => null)
  if (!session) return null

  const user = await ensureUser(session.user)
  return toSessionUser(user, session.user)
}
