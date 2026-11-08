import { timingSafeEqual } from "node:crypto"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"

import { getAuthSession } from "@/lib/cloudhike-auth"
import {
  OAUTH_STATE_COOKIE,
  ensureUser,
  setSessionCookie,
  toSessionUser,
} from "@/lib/session"

function sameState(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

// Exchanges the token from the social sign-in redirect for our session cookie.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const token = typeof body?.token === "string" ? body.token : ""
  const state = typeof body?.state === "string" ? body.state : ""

  const store = await cookies()
  const expected = store.get(OAUTH_STATE_COOKIE)?.value ?? ""
  store.delete(OAUTH_STATE_COOKIE)

  if (!token || !state || !expected || !sameState(state, expected)) {
    return NextResponse.json(
      { error: "This sign-in link has expired. Please try again." },
      { status: 400 }
    )
  }

  try {
    const session = await getAuthSession(token)
    if (!session) {
      return NextResponse.json(
        { error: "Sign-in could not be verified. Please try again." },
        { status: 401 }
      )
    }
    const user = await ensureUser(session.user)
    await setSessionCookie(token)
    return NextResponse.json({ user: toSessionUser(user, session.user) })
  } catch (error) {
    console.error("Social sign-in failed", error)
    return NextResponse.json(
      { error: "Something went wrong on our side. Please try again." },
      { status: 500 }
    )
  }
}
