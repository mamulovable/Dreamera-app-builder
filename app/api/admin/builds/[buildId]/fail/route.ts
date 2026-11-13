import { NextResponse } from "next/server"

import { adminActionResponse, adminFailBuild, requireAdminApi } from "@/lib/admin"

type Context = { params: Promise<{ buildId: string }> }

export async function POST(_request: Request, context: Context) {
  const auth = await requireAdminApi()
  if (auth.failure) return auth.failure

  const { buildId } = await context.params
  try {
    const result = await adminFailBuild(auth.user, buildId)
    return NextResponse.json(result)
  } catch (error) {
    return adminActionResponse(error)
  }
}
