import { NextResponse } from "next/server"

import { adminActionResponse, adminDeleteSecret, requireAdminApi } from "@/lib/admin"

type Context = { params: Promise<{ projectId: string }> }

export async function DELETE(request: Request, context: Context) {
  const auth = await requireAdminApi()
  if (auth.failure) return auth.failure

  const { projectId } = await context.params
  const body = (await request.json().catch(() => null)) as { name?: unknown } | null
  if (typeof body?.name !== "string") {
    return NextResponse.json({ error: "Send the key name to remove." }, { status: 400 })
  }

  try {
    const result = await adminDeleteSecret(auth.user, projectId, body.name)
    return NextResponse.json(result)
  } catch (error) {
    return adminActionResponse(error)
  }
}
