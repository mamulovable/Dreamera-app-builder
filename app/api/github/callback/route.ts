import { timingSafeEqual } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"

import { exchangeGitHubCode, githubCallbackUrl } from "@/lib/github/client"
import { GITHUB_STATE_COOKIE } from "@/lib/github/connect-state"
import { saveGitHubConnection } from "@/lib/github/projects"
import type { GitHubConnectResult } from "@/lib/github-protocol"
import { getProjectAccess } from "@/lib/project-access"
import { getCurrentUser } from "@/lib/session"

function sameState(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/**
 * Where GitHub returns the browser. The project comes from this browser's own
 * cookie, never from the URL, so the redirect back can't be pointed elsewhere.
 */
export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
  const { searchParams } = request.nextUrl
  const [expectedState, projectId] = (request.cookies.get(GITHUB_STATE_COOKIE)?.value ?? "").split(".")
  const state = searchParams.get("state")

  const back = (path: string) => {
    const response = NextResponse.redirect(new URL(path, appUrl))
    response.cookies.delete({ name: GITHUB_STATE_COOKIE, path: "/api/github" })
    return response
  }
  if (!expectedState || !projectId || !state || !sameState(expectedState, state)) return back("/")

  const finish = (result: GitHubConnectResult) => back(`/workspace/${projectId}?github=${result}`)

  const user = await getCurrentUser().catch(() => null)
  if (!user) return back("/")
  const access = await getProjectAccess(projectId, user.id)
  if (access?.role !== "owner") return back("/")

  if (searchParams.get("error") === "access_denied") return finish("denied")
  const code = searchParams.get("code")
  if (!code) return finish("error")

  try {
    await saveGitHubConnection(user.id, await exchangeGitHubCode(code, githubCallbackUrl(request.nextUrl.origin)))
    return finish("connected")
  } catch (error) {
    console.error("Connecting a GitHub account failed", error)
    return finish("error")
  }
}
