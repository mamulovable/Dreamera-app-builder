import { eq } from "drizzle-orm"

import { builderSettings, db } from "@/db"

export type AiProviderName = "cloudhike" | "gemini"

const DEFAULT_CLOUDHIKE_MODEL = "claude-sonnet-5-5"
const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash"
const MODEL_PATTERN = /^[A-Za-z0-9._:/-]{1,120}$/

export type ProviderModels = { planner: string; builder: string }

export type BuilderRoute = {
  primary: AiProviderName
  fallback: AiProviderName | "none"
  plannerModel: string
  builderModel: string
  overrides: Record<AiProviderName, { planner: string | null; builder: string | null }>
  ready: Record<AiProviderName, boolean>
  defaults: Record<AiProviderName, ProviderModels>
}

function modelFromEnv(name: string, fallback: string) {
  const value = process.env[name]?.trim()
  return value || fallback
}

export function cloudhikeCredentials() {
  const baseURL = process.env.AI_BASE_URL?.trim()
  const apiKey = process.env.AI_API_KEY?.trim()
  return baseURL && apiKey ? { baseURL, apiKey } : null
}

export function geminiCredentials() {
  const key = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY
  const apiKey = key?.trim()
  if (!apiKey) return null
  const baseURL = process.env.GOOGLE_AI_BASE_URL?.trim() || "https://generativelanguage.googleapis.com/v1beta/openai/"
  return { baseURL, apiKey }
}

export function providerReady(provider: AiProviderName) {
  return provider === "cloudhike" ? Boolean(cloudhikeCredentials()) : Boolean(geminiCredentials())
}

export function envPrimary(): AiProviderName {
  const value = process.env.AI_PRIMARY_PROVIDER?.trim().toLowerCase()
  return value === "gemini" ? "gemini" : "cloudhike"
}

export function envModels(provider: AiProviderName): ProviderModels {
  if (provider === "cloudhike") {
    const planner = modelFromEnv("CLOUDHIKE_MODEL", DEFAULT_CLOUDHIKE_MODEL)
    return { planner, builder: modelFromEnv("CLOUDHIKE_BUILDER_MODEL", planner) }
  }
  const planner = modelFromEnv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)
  return { planner, builder: modelFromEnv("GEMINI_BUILDER_MODEL", planner) }
}

function fallbackFor(primary: AiProviderName): AiProviderName | "none" {
  const value = process.env.AI_FALLBACK_PROVIDER?.trim().toLowerCase()
  if (value === "none" || value === "off" || value === "false") return "none"
  if (value === "cloudhike" || value === "gemini") {
    if (value === primary || !providerReady(value)) return "none"
    return value
  }
  const other: AiProviderName = primary === "cloudhike" ? "gemini" : "cloudhike"
  return providerReady(other) ? other : "none"
}

function blank(value: string | null | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function routeFrom(row: {
  primaryProvider: string
  cloudhikePlannerModel: string | null
  cloudhikeBuilderModel: string | null
  geminiPlannerModel: string | null
  geminiBuilderModel: string | null
} | null): BuilderRoute {
  const overrides: BuilderRoute["overrides"] = {
    cloudhike: {
      planner: blank(row?.cloudhikePlannerModel),
      builder: blank(row?.cloudhikeBuilderModel),
    },
    gemini: {
      planner: blank(row?.geminiPlannerModel),
      builder: blank(row?.geminiBuilderModel),
    },
  }
  const stored = row?.primaryProvider === "gemini" || row?.primaryProvider === "cloudhike" ? row.primaryProvider : null
  const preferred = stored ?? envPrimary()
  const primary = providerReady(preferred) ? preferred : providerReady("cloudhike") ? "cloudhike" : "gemini"
  const defaults = { cloudhike: envModels("cloudhike"), gemini: envModels("gemini") }
  const chosen = overrides[primary]
  const base = defaults[primary]
  return {
    primary,
    fallback: fallbackFor(primary),
    plannerModel: chosen.planner || base.planner,
    builderModel: chosen.builder || base.builder,
    overrides,
    ready: { cloudhike: providerReady("cloudhike"), gemini: providerReady("gemini") },
    defaults,
  }
}

/** The provider and models the next builder call will use. Admin overrides win over the env defaults. */
export async function readBuilderRoute(): Promise<BuilderRoute> {
  try {
    const [row] = await db.select().from(builderSettings).where(eq(builderSettings.id, "default")).limit(1)
    return routeFrom(row ?? null)
  } catch (error) {
    console.error("Couldn't read the builder provider setting", error)
    return routeFrom(null)
  }
}

export function optionalModel(value: unknown) {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (!MODEL_PATTERN.test(trimmed)) {
    throw new Error("A model id can use letters, numbers, and . _ : / - only.")
  }
  return trimmed
}

export async function saveBuilderSettings(input: {
  primary: AiProviderName
  cloudhikePlannerModel: string | null
  cloudhikeBuilderModel: string | null
  geminiPlannerModel: string | null
  geminiBuilderModel: string | null
  updatedBy: number
}) {
  await db
    .insert(builderSettings)
    .values({
      id: "default",
      primaryProvider: input.primary,
      cloudhikePlannerModel: input.cloudhikePlannerModel,
      cloudhikeBuilderModel: input.cloudhikeBuilderModel,
      geminiPlannerModel: input.geminiPlannerModel,
      geminiBuilderModel: input.geminiBuilderModel,
      updatedBy: input.updatedBy,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: builderSettings.id,
      set: {
        primaryProvider: input.primary,
        cloudhikePlannerModel: input.cloudhikePlannerModel,
        cloudhikeBuilderModel: input.cloudhikeBuilderModel,
        geminiPlannerModel: input.geminiPlannerModel,
        geminiBuilderModel: input.geminiBuilderModel,
        updatedBy: input.updatedBy,
        updatedAt: new Date(),
      },
    })
  return readBuilderRoute()
}
