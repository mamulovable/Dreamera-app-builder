import { NextResponse } from "next/server"

import { clearSessionCookie, getCurrentUser, getSessionToken } from "@/lib/session"

export async function GET() {
  try {
    const user = await getCurrentUser()
    // Drop a cookie whose session has expired or been revoked.
    if (!user && (await getSessionToken())) await clearSessionCookie()
    return NextResponse.json({ user }, { headers: { "cache-control": "no-store" } })
  } catch (error) {
    console.error("Session lookup failed", error)
    return NextResponse.json({ user: null, error: "Session lookup failed." }, { status: 500 })
  }
}
