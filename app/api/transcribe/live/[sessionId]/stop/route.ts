import { NextResponse } from "next/server"

import { closeLiveTranscribeSession, sendLiveActivity } from "@/lib/ai/live-transcribe-sessions"
import { getCurrentUser } from "@/lib/session"

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

/**
 * Ends the push-to-talk turn and closes the Gemini Live session.
 */
export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const user = await getCurrentUser().catch(() => null)
  if (!user) return error("Please sign in to use voice dictation.", 401)

  const { sessionId } = await context.params
  const body = (await request.json().catch(() => null)) as { waitMs?: unknown } | null
  const waitMs = typeof body?.waitMs === "number" && body.waitMs > 0 ? Math.min(body.waitMs, 4000) : 1200

  sendLiveActivity(sessionId, user.id, "end")

  // Give Gemini a moment to emit the SMART final before we tear the socket down.
  await new Promise((resolve) => setTimeout(resolve, waitMs))
  const text = closeLiveTranscribeSession(sessionId, user.id)
  return NextResponse.json({ text })
}
