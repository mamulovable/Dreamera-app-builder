import { NextResponse } from "next/server"

import { GitHubError } from "@/lib/github/client"
import { listRepositories } from "@/lib/github/projects"
import { getCurrentUser } from "@/lib/session"

/** The repositories the signed-in person can push to. */
export async function GET() {
  const user = await getCurrentUser().catch(() => null)
  if (!user) return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 })

  try {
    return NextResponse.json({ repositories: await listRepositories(user.id) })
  } catch (cause) {
    if (cause instanceof GitHubError) {
      return NextResponse.json({ error: cause.message, code: cause.code }, { status: cause.code === "reauth" ? 401 : 502 })
    }
    console.error("Listing GitHub repositories failed", cause)
    return NextResponse.json({ error: "We couldn't load your repositories. Please try again." }, { status: 500 })
  }
}
