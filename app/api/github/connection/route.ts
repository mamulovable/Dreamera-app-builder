import { NextResponse } from "next/server"

import { disconnectGitHub } from "@/lib/github/projects"
import { getCurrentUser } from "@/lib/session"

/** Disconnects the signed-in person's GitHub account. What they already pushed stays on GitHub. */
export async function DELETE() {
  const user = await getCurrentUser().catch(() => null)
  if (!user) return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 })

  try {
    await disconnectGitHub(user.id)
    return NextResponse.json({ ok: true })
  } catch (cause) {
    console.error("Disconnecting GitHub failed", cause)
    return NextResponse.json({ error: "We couldn't disconnect GitHub. Please try again." }, { status: 500 })
  }
}
