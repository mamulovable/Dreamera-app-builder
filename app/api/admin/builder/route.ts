import { NextResponse } from "next/server"

import { adminAuditLog, db } from "@/db"
import {
  AI_PROVIDER_LABELS,
  isAiProviderName,
  optionalModel,
  providerReady,
  saveBuilderSettings,
  type AiProviderName,
} from "@/lib/agent/provider-settings"
import { AdminActionError, adminActionResponse, requireAdminApi } from "@/lib/admin"

function setupHint(provider: AiProviderName) {
  if (provider === "cloudhike") return "CloudHike isn't set up. Add AI_BASE_URL and AI_API_KEY."
  if (provider === "gemini") return "Gemini isn't set up. Add GOOGLE_AI_API_KEY."
  return "OpenRouter isn't set up. Add OPENROUTER_API_KEY."
}

export async function POST(request: Request) {
  const auth = await requireAdminApi()
  if (auth.failure) return auth.failure

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const primary = isAiProviderName(body?.primary) ? body.primary : null
  if (!primary) {
    return NextResponse.json({ error: "Choose CloudHike, Gemini, or OpenRouter." }, { status: 400 })
  }
  if (!providerReady(primary)) {
    return NextResponse.json({ error: setupHint(primary) }, { status: 400 })
  }

  try {
    const route = await saveBuilderSettings({
      primary,
      cloudhikePlannerModel: optionalModel(body?.cloudhikePlannerModel),
      cloudhikeBuilderModel: optionalModel(body?.cloudhikeBuilderModel),
      geminiPlannerModel: optionalModel(body?.geminiPlannerModel),
      geminiBuilderModel: optionalModel(body?.geminiBuilderModel),
      openrouterPlannerModel: optionalModel(body?.openrouterPlannerModel),
      openrouterBuilderModel: optionalModel(body?.openrouterBuilderModel),
      updatedBy: auth.user.id,
    })
    await db.insert(adminAuditLog).values({
      adminUserId: auth.user.id,
      action: "set-builder",
      detail: {
        primary: route.primary,
        providerLabel: AI_PROVIDER_LABELS[route.primary],
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
