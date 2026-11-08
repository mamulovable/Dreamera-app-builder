import { randomBytes } from "node:crypto"
import { NextResponse, type NextRequest } from "next/server"
import { and, eq } from "drizzle-orm"

import { db, projects } from "@/db"
import { CLOUDHIKE_STATE_COOKIE, CLOUDHIKE_STATE_MAX_AGE } from "@/lib/cloudhike/connect-state"
import { cloudhikeCallbackUrl, cloudhikeConnectUrl, isCloudHikeAvailable } from "@/lib/cloudhike/client"
import { getCurrentUser } from "@/lib/session"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Sends the browser to CloudHike to allow access. It comes back at the callback route. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const user = await getCurrentUser().catch(() => null)
  if (!user) return NextResponse.redirect(new URL("/", request.url))
  if (!UUID_PATTERN.test(projectId)) return new NextResponse("Project not found.", { status: 404 })

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
  if (!project) return new NextResponse("Project not found.", { status: 404 })
  if (!isCloudHikeAvailable()) return NextResponse.redirect(new URL(`/workspace/${project.id}?backend=error`, request.url))

  // Ties the callback to this browser and project, so nobody can plant their own CloudHike account here.
  const state = randomBytes(32).toString("hex")
  const response = NextResponse.redirect(cloudhikeConnectUrl(cloudhikeCallbackUrl(request.nextUrl.origin), state))
  response.cookies.set(CLOUDHIKE_STATE_COOKIE, `${state}.${project.id}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/cloudhike",
    maxAge: CLOUDHIKE_STATE_MAX_AGE,
  })
  return response
}
