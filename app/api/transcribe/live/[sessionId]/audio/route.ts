import { NextResponse } from "next/server"

import { sendLiveActivity, sendLiveAudio } from "@/lib/ai/live-transcribe-sessions"
import { getCurrentUser } from "@/lib/session"

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

/**
 * Forwards a PCM chunk (or activity start/end) into the Gemini Live session.
 */
export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  const user = await getCurrentUser().catch(() => null)
  if (!user) return error("Please sign in to use voice dictation.", 401)

  const { sessionId } = await context.params
  const body = (await request.json().catch(() => null)) as
    | { pcm?: unknown; activity?: unknown }
    | null

  if (body?.activity === "start" || body?.activity === "end") {
    const ok = sendLiveActivity(sessionId, user.id, body.activity)
    if (!ok) return error("That voice session isn't active anymore.", 404)
    return NextResponse.json({ ok: true })
  }

  const pcm = typeof body?.pcm === "string" ? body.pcm : ""
  if (!pcm) return error("Missing audio.", 400)
  const ok = sendLiveAudio(sessionId, user.id, pcm)
  if (!ok) return error("That voice session isn't active anymore.", 404)
  return NextResponse.json({ ok: true })
}
