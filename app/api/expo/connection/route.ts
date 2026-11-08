import { NextResponse } from "next/server"

import { connectExpo, disconnectExpo } from "@/lib/publish/builds"
import { ExpoError } from "@/lib/publish/expo"
import { getCurrentUser } from "@/lib/session"

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

/** Saves the signed-in person's Expo token. The answer only ever names the account, never the token. */
export async function PUT(request: Request) {
  const user = await getCurrentUser().catch(() => null)
  if (!user) return error("Please sign in to continue.", 401)

  const body = (await request.json().catch(() => null)) as { token?: unknown } | null
  const token = typeof body?.token === "string" ? body.token.trim() : ""
  if (!token || token.length > 500 || /\s/.test(token)) return error("Paste the access token from your Expo account.", 400)

  try {
    return NextResponse.json({ account: await connectExpo(user.id, token) })
  } catch (cause) {
    if (cause instanceof ExpoError && cause.unauthorized) return error("Expo didn't accept that token. Check it and try again.", 400)
    console.error("Connecting Expo failed")
    return error("We couldn't connect to Expo. Please try again.", 502)
  }
}

/** Disconnects Expo. The token is deleted here, and that was the only copy AppForge had. */
export async function DELETE() {
  const user = await getCurrentUser().catch(() => null)
  if (!user) return error("Please sign in to continue.", 401)

  try {
    await disconnectExpo(user.id)
    return NextResponse.json({})
  } catch (cause) {
    console.error("Disconnecting Expo failed", cause)
    return error("We couldn't disconnect Expo. Please try again.", 500)
  }
}
