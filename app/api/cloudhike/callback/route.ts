import { timingSafeEqual } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"
import { and, eq } from "drizzle-orm"

import { db, projects } from "@/db"
import type { BackendConnectResult } from "@/lib/backend-protocol"
import { linkProject, saveConnection } from "@/lib/cloudhike/backend"
import { cloudhikeCallbackUrl, exchangeCloudHikeCode } from "@/lib/cloudhike/client"
import { CLOUDHIKE_STATE_COOKIE } from "@/lib/cloudhike/connect-state"
import { getCurrentUser } from "@/lib/session"

function sameState(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/**
 * Where CloudHike returns the browser. The project comes from this browser's own
 * cookie, never from the URL, so the redirect back can't be pointed elsewhere.
 */
export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
  const { searchParams } = request.nextUrl
  const [expectedState, projectId] = (request.cookies.get(CLOUDHIKE_STATE_COOKIE)?.value ?? "").split(".")
  const state = searchParams.get("state")

  const back = (path: string) => {
    const response = NextResponse.redirect(new URL(path, appUrl))
    response.cookies.delete({ name: CLOUDHIKE_STATE_COOKIE, path: "/api/cloudhike" })
    return response
  }
  if (!expectedState || !projectId || !state || !sameState(expectedState, state)) return back("/")

  const finish = (result: BackendConnectResult) => back(`/workspace/${projectId}?backend=${result}`)

  const user = await getCurrentUser().catch(() => null)
  if (!user) return back("/")
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
  if (!project) return back("/")

  if (searchParams.get("error") === "access_denied") return finish("denied")
  const code = searchParams.get("code")
  if (!code) return finish("error")

  try {
    const grant = await exchangeCloudHikeCode(code, cloudhikeCallbackUrl(request.nextUrl.origin))
    await saveConnection(user.id, grant)
    await linkProject(project.id)
    return finish("connected")
  } catch (error) {
    console.error("Connecting a CloudHike account failed", error)
    return finish("error")
  }
}
