import { NextResponse } from "next/server"

import { signOutSession } from "@/lib/cloudhike-auth"
import { clearSessionCookie, getSessionToken } from "@/lib/session"

export async function POST() {
  const token = await getSessionToken()
  if (token) {
    // Clear the cookie even if the auth service is unreachable.
    await signOutSession(token).catch((error) =>
      console.error("Sign-out request failed", error)
    )
  }
  await clearSessionCookie()
  return NextResponse.json({ ok: true })
}
