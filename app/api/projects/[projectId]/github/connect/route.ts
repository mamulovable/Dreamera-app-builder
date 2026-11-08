import { randomBytes } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"

import { GITHUB_STATE_COOKIE, GITHUB_STATE_MAX_AGE } from "@/lib/github/connect-state"
import { githubAuthorizeUrl, githubCallbackUrl, isGitHubAvailable } from "@/lib/github/client"
import { getProjectAccess } from "@/lib/project-access"
import { getCurrentUser } from "@/lib/session"

/** Sends the browser to GitHub to allow access. It comes back at the callback route. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const user = await getCurrentUser().catch(() => null)
  if (!user) return NextResponse.redirect(new URL("/", request.url))

  const access = await getProjectAccess(projectId, user.id)
  if (access?.role !== "owner") return new NextResponse("Project not found.", { status: 404 })
  if (!isGitHubAvailable()) return NextResponse.redirect(new URL(`/workspace/${projectId}?github=error`, request.url))

  // Ties the callback to this browser and project, so nobody can plant their own GitHub account here.
  const state = randomBytes(32).toString("hex")
  const response = NextResponse.redirect(githubAuthorizeUrl(githubCallbackUrl(request.nextUrl.origin), state))
  response.cookies.set(GITHUB_STATE_COOKIE, `${state}.${projectId}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/github",
    maxAge: GITHUB_STATE_MAX_AGE,
  })
  return response
}
