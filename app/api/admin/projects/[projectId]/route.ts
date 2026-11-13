import { NextResponse } from "next/server"

import { adminActionResponse, adminDeleteProject, adminSetPublic, requireAdminApi } from "@/lib/admin"

type Context = { params: Promise<{ projectId: string }> }

export async function PATCH(request: Request, context: Context) {
  const auth = await requireAdminApi()
  if (auth.failure) return auth.failure

  const { projectId } = await context.params
  const body = (await request.json().catch(() => null)) as { isPublic?: unknown } | null
  if (typeof body?.isPublic !== "boolean") {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 })
  }

  try {
    const result = await adminSetPublic(auth.user, projectId, body.isPublic)
    return NextResponse.json(result)
  } catch (error) {
    return adminActionResponse(error)
  }
}

export async function DELETE(_request: Request, context: Context) {
  const auth = await requireAdminApi()
  if (auth.failure) return auth.failure

  const { projectId } = await context.params
  try {
    const result = await adminDeleteProject(auth.user, projectId)
    return NextResponse.json(result)
  } catch (error) {
    return adminActionResponse(error)
  }
}
