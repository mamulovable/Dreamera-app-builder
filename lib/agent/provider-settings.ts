import { eq, sql } from "drizzle-orm"

import { builderSettings, db } from "@/db"
import type { ModelPriceBook, ModelTokenPrice } from "@/lib/token-cost"

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
  /** Fallback USD per 1 million input tokens when a model has no own price. */
  inputPricePerMillion: number
  /** Fallback USD per 1 million output tokens when a model has no own price. */
  outputPricePerMillion: number
  /** Per-model USD prices for 1 million input and output tokens. */
  modelPrices: ModelPriceBook
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

function pricePerMillion(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0
}

function readModelPrices(value: unknown): ModelPriceBook {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const book: ModelPriceBook = {}
  for (const [model, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!MODEL_PATTERN.test(model) || !entry || typeof entry !== "object" || Array.isArray(entry)) continue
    const input = pricePerMillion((entry as { input?: number }).input)
    const output = pricePerMillion((entry as { output?: number }).output)
    if (input === 0 && output === 0) continue
    book[model] = { input, output }
  }
  return book
}

function routeFrom(row: {
  primaryProvider: string
  cloudhikePlannerModel: string | null
  cloudhikeBuilderModel: string | null
  geminiPlannerModel: string | null
  geminiBuilderModel: string | null
  openrouterPlannerModel: string | null
  openrouterBuilderModel: string | null
  inputPricePerMillion?: number | null
  outputPricePerMillion?: number | null
  modelPrices?: unknown
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
    inputPricePerMillion: pricePerMillion(row?.inputPricePerMillion),
    outputPricePerMillion: pricePerMillion(row?.outputPricePerMillion),
    modelPrices: readModelPrices(row?.modelPrices),
    overrides,
    ready: {
      cloudhike: providerReady("cloudhike"),
      gemini: providerReady("gemini"),
      openrouter: providerReady("openrouter"),
    },
    defaults,
  }
}

function missingPriceColumn(error: unknown) {
  const cause = error && typeof error === "object" && "cause" in error ? (error as { cause?: { code?: string } }).cause : undefined
  const message = error instanceof Error ? error.message : ""
  return (
    cause?.code === "42703" &&
    (message.includes("price_per_million") || message.includes("model_prices"))
  )
}

/** Adds the price columns when this build is ahead of the database. */
async function ensureTokenPriceColumns() {
  await db.execute(sql`ALTER TABLE "builder_settings" ADD COLUMN IF NOT EXISTS "input_price_per_million" double precision DEFAULT 0 NOT NULL`)
  await db.execute(sql`ALTER TABLE "builder_settings" ADD COLUMN IF NOT EXISTS "output_price_per_million" double precision DEFAULT 0 NOT NULL`)
  await db.execute(sql`ALTER TABLE "builder_settings" ADD COLUMN IF NOT EXISTS "model_prices" jsonb DEFAULT '{}'::jsonb NOT NULL`)
}

/** The provider and models the next builder call will use. Admin overrides win over the env defaults. */
export async function readBuilderRoute(): Promise<BuilderRoute> {
  try {
    const [row] = await db.select().from(builderSettings).where(eq(builderSettings.id, "default")).limit(1)
    return routeFrom(row ?? null)
  } catch (error) {
    if (missingPriceColumn(error)) {
      try {
        await ensureTokenPriceColumns()
        const [row] = await db.select().from(builderSettings).where(eq(builderSettings.id, "default")).limit(1)
        return routeFrom(row ?? null)
      } catch (retryError) {
        console.error("Couldn't add the builder token price columns", retryError)
      }
    }
    console.error("Couldn't read the builder provider setting", error)
    return routeFrom(null)
  }
}

/** USD per 1 million tokens. Blank is zero. Anything else must be a finite price from 0 up. */
export function tokenPricePerMillion(value: unknown) {
  if (value == null || value === "") return 0
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN
  if (!Number.isFinite(number) || number < 0 || number > 1_000_000) {
    throw new Error("Token prices must be from 0 to 1,000,000 USD per 1 million tokens.")
  }
  return Math.round(number * 1_000_000) / 1_000_000
}

/** Parses admin form rows into a model price book. Blank both sides drops that model. */
export function parseModelPrices(value: unknown): ModelPriceBook {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const book: ModelPriceBook = {}
  for (const [rawModel, entry] of Object.entries(value as Record<string, unknown>)) {
    const model = rawModel.trim()
    if (!MODEL_PATTERN.test(model) || !entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Each model price needs a valid model id and input/output numbers.")
    }
    const input = tokenPricePerMillion((entry as { input?: unknown }).input)
    const output = tokenPricePerMillion((entry as { output?: unknown }).output)
    if (input === 0 && output === 0) continue
    book[model] = { input, output }
  }
  return book
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

export function defaultTokenPrice(route: BuilderRoute): ModelTokenPrice {
  return { input: route.inputPricePerMillion, output: route.outputPricePerMillion }
}

export async function saveBuilderSettings(input: {
  primary: AiProviderName
  cloudhikePlannerModel: string | null
  cloudhikeBuilderModel: string | null
  geminiPlannerModel: string | null
  geminiBuilderModel: string | null
  openrouterPlannerModel: string | null
  openrouterBuilderModel: string | null
  inputPricePerMillion: number
  outputPricePerMillion: number
  modelPrices: ModelPriceBook
  updatedBy: number
}) {
  await ensureTokenPriceColumns()
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
      inputPricePerMillion: input.inputPricePerMillion,
      outputPricePerMillion: input.outputPricePerMillion,
      modelPrices: input.modelPrices,
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
        inputPricePerMillion: input.inputPricePerMillion,
        outputPricePerMillion: input.outputPricePerMillion,
        modelPrices: input.modelPrices,
        updatedBy: input.updatedBy,
        updatedAt: new Date(),
      },
    })
  return readBuilderRoute()
}
