import { NextResponse } from "next/server"

import { adminAuditLog, db } from "@/db"
import { optionalModel, providerReady, saveBuilderSettings, type AiProviderName } from "@/lib/agent/provider-settings"
import { AdminActionError, adminActionResponse, requireAdminApi } from "@/lib/admin"

function providerName(value: unknown): AiProviderName | null {
  return value === "cloudhike" || value === "gemini" ? value : null
}

export async function POST(request: Request) {
  const auth = await requireAdminApi()
  if (auth.failure) return auth.failure

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const primary = providerName(body?.primary)
  if (!primary) return NextResponse.json({ error: "Choose CloudHike or Gemini." }, { status: 400 })
  if (!providerReady(primary)) {
    const message =
      primary === "cloudhike"
        ? "CloudHike isn't set up. Add AI_BASE_URL and AI_API_KEY."
        : "Gemini isn't set up. Add GOOGLE_AI_API_KEY."
    return NextResponse.json({ error: message }, { status: 400 })
  }

  try {
    const route = await saveBuilderSettings({
      primary,
      cloudhikePlannerModel: optionalModel(body?.cloudhikePlannerModel),
      cloudhikeBuilderModel: optionalModel(body?.cloudhikeBuilderModel),
      geminiPlannerModel: optionalModel(body?.geminiPlannerModel),
      geminiBuilderModel: optionalModel(body?.geminiBuilderModel),
      updatedBy: auth.user.id,
    })
    await db.insert(adminAuditLog).values({
      adminUserId: auth.user.id,
      action: "set-builder",
      detail: {
        primary: route.primary,
        plannerModel: route.plannerModel,
        builderModel: route.builderModel,
        fallback: route.fallback,
      },
    })
    return NextResponse.json(route)
  } catch (error) {
    if (error instanceof Error && error.message.includes("model id")) {
      return adminActionResponse(new AdminActionError(error.message))
    }
    return adminActionResponse(error)
  }
}
