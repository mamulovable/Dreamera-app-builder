import { NextResponse } from "next/server"

import { adminActionResponse, adminAdjustCredits, requireAdminApi } from "@/lib/admin"

export async function POST(request: Request) {
  const auth = await requireAdminApi()
  if (auth.failure) return auth.failure

  const body = (await request.json().catch(() => null)) as {
    userId?: unknown
    amount?: unknown
    note?: unknown
  } | null

  if (typeof body?.userId !== "number" || !Number.isInteger(body.userId)) {
    return NextResponse.json({ error: "Invalid user." }, { status: 400 })
  }
  if (typeof body.amount !== "number" || !Number.isInteger(body.amount)) {
    return NextResponse.json({ error: "Enter a whole number of credits." }, { status: 400 })
  }
  const note = typeof body.note === "string" ? body.note.slice(0, 500) : ""

  try {
    const result = await adminAdjustCredits(auth.user, body.userId, body.amount, note)
    return NextResponse.json(result)
  } catch (error) {
    return adminActionResponse(error)
  }
}
