import { eq } from "drizzle-orm"

import { builderSettings, db } from "@/db"

export const AI_PROVIDERS = ["cloudhike", "gemini", "openrouter"] as const
export type AiProviderName = (typeof AI_PROVIDERS)[number]

export const AI_PROVIDER_LABELS: Record<AiProviderName, string> = {
  cloudhike: "CloudHike",
  gemini: "Gemini",
  openrouter: "OpenRouter",
}

const DEFAULT_CLOUDHIKE_MODEL = "claude-sonnet-5-5"
const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash"
const DEFAULT_OPENROUTER_MODEL = "qwen/qwen4-max"
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

export function isAiProviderName(value: unknown): value is AiProviderName {
  return typeof value === "string" && (AI_PROVIDERS as readonly string[]).includes(value)
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

export function openrouterCredentials() {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim()
  if (!apiKey) return null
  const baseURL = process.env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1"
  return { baseURL, apiKey }
}

export function providerReady(provider: AiProviderName) {
  if (provider === "cloudhike") return Boolean(cloudhikeCredentials())
  if (provider === "gemini") return Boolean(geminiCredentials())
  return Boolean(openrouterCredentials())
}

export function envPrimary(): AiProviderName {
  const value = process.env.AI_PRIMARY_PROVIDER?.trim().toLowerCase()
  return isAiProviderName(value) ? value : "cloudhike"
}

export function envModels(provider: AiProviderName): ProviderModels {
  if (provider === "cloudhike") {
    const planner = modelFromEnv("CLOUDHIKE_MODEL", DEFAULT_CLOUDHIKE_MODEL)
    return { planner, builder: modelFromEnv("CLOUDHIKE_BUILDER_MODEL", planner) }
  }
  if (provider === "gemini") {
    const planner = modelFromEnv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)
    return { planner, builder: modelFromEnv("GEMINI_BUILDER_MODEL", planner) }
  }
  const planner = modelFromEnv("OPENROUTER_MODEL", DEFAULT_OPENROUTER_MODEL)
  return { planner, builder: modelFromEnv("OPENROUTER_BUILDER_MODEL", planner) }
}

function firstReadyProvider(prefer?: AiProviderName | null): AiProviderName {
  if (prefer && providerReady(prefer)) return prefer
  for (const name of AI_PROVIDERS) {
    if (providerReady(name)) return name
  }
  return prefer ?? "cloudhike"
}

function fallbackFor(primary: AiProviderName): AiProviderName | "none" {
  const value = process.env.AI_FALLBACK_PROVIDER?.trim().toLowerCase()
  if (value === "none" || value === "off" || value === "false") return "none"
  if (isAiProviderName(value)) {
    if (value === primary || !providerReady(value)) return "none"
    return value
  }
  for (const name of AI_PROVIDERS) {
    if (name !== primary && providerReady(name)) return name
  }
  return "none"
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
  openrouterPlannerModel: string | null
  openrouterBuilderModel: string | null
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
    openrouter: {
      planner: blank(row?.openrouterPlannerModel),
      builder: blank(row?.openrouterBuilderModel),
    },
  }
  const stored = isAiProviderName(row?.primaryProvider) ? row.primaryProvider : null
  const primary = firstReadyProvider(stored ?? envPrimary())
  const defaults = {
    cloudhike: envModels("cloudhike"),
    gemini: envModels("gemini"),
    openrouter: envModels("openrouter"),
  }
  const chosen = overrides[primary]
  const base = defaults[primary]
  return {
    primary,
    fallback: fallbackFor(primary),
    plannerModel: chosen.planner || base.planner,
    builderModel: chosen.builder || base.builder,
    overrides,
    ready: {
      cloudhike: providerReady("cloudhike"),
      gemini: providerReady("gemini"),
      openrouter: providerReady("openrouter"),
    },
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
  openrouterPlannerModel: string | null
  openrouterBuilderModel: string | null
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
      openrouterPlannerModel: input.openrouterPlannerModel,
      openrouterBuilderModel: input.openrouterBuilderModel,
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
        openrouterPlannerModel: input.openrouterPlannerModel,
        openrouterBuilderModel: input.openrouterBuilderModel,
        updatedBy: input.updatedBy,
        updatedAt: new Date(),
      },
    })
  return readBuilderRoute()
}
