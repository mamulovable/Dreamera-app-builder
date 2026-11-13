import OpenAI, { APIError, APIUserAbortError } from "openai"
import {
  OpenAIProvider,
  setDefaultModelProvider,
  setDefaultOpenAIClient,
  setOpenAIAPI,
  setTracingDisabled,
  type Model,
  type ModelRequest,
  type ModelResponse,
} from "@openai/agents"

import { PLANS } from "@/lib/plans"

// The OpenAI Agents SDK talks to an OpenAI-compatible endpoint: CloudHike or
// Gemini on Google AI. Both serve Chat Completions (not the Responses API), and
// traces would go to OpenAI's dashboard, so both are configured here once per
// process. AI_PRIMARY_PROVIDER chooses which one runs first. If that call fails
// before any output, the same request is sent to AI_FALLBACK_PROVIDER.

const DEFAULT_MODEL = "claude-sonnet-5-5"
const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash"
const GOOGLE_AI_BASE_URL =
  process.env.GOOGLE_AI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai/"

type AiProviderName = "cloudhike" | "gemini"

function modelFromEnv(name: string, fallback: string) {
  const value = process.env[name]?.trim()
  return value || fallback
}

function googleAiApiKey() {
  const key = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY
  const trimmed = key?.trim()
  return trimmed ? trimmed : undefined
}

function providerConfigured(provider: AiProviderName) {
  if (provider === "cloudhike") {
    return Boolean(process.env.AI_BASE_URL?.trim() && process.env.AI_API_KEY?.trim())
  }
  return Boolean(googleAiApiKey())
}

function primaryProvider(): AiProviderName {
  const value = process.env.AI_PRIMARY_PROVIDER?.trim().toLowerCase()
  if (!value) return "cloudhike"
  if (value === "cloudhike" || value === "gemini") return value
  throw new Error("AI_PRIMARY_PROVIDER must be cloudhike or gemini.")
}

function fallbackProvider(primary: AiProviderName): AiProviderName | "none" {
  const value = process.env.AI_FALLBACK_PROVIDER?.trim().toLowerCase()
  if (value === "none" || value === "off" || value === "false") return "none"
  if (value === "cloudhike" || value === "gemini") {
    if (value === primary) {
      throw new Error("AI_FALLBACK_PROVIDER must be different from AI_PRIMARY_PROVIDER.")
    }
    return value
  }
  if (value) throw new Error("AI_FALLBACK_PROVIDER must be cloudhike, gemini, or none.")
  const other: AiProviderName = primary === "cloudhike" ? "gemini" : "cloudhike"
  return providerConfigured(other) ? other : "none"
}

const PRIMARY_PROVIDER = primaryProvider()
const FALLBACK_PROVIDER = fallbackProvider(PRIMARY_PROVIDER)

type ModelRole = "planner" | "builder"

function providerModels(provider: AiProviderName): Record<ModelRole, string> {
  if (provider === "cloudhike") {
    const planner = modelFromEnv("CLOUDHIKE_MODEL", DEFAULT_MODEL)
    return { planner, builder: modelFromEnv("CLOUDHIKE_BUILDER_MODEL", planner) }
  }
  const planner = modelFromEnv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)
  return { planner, builder: modelFromEnv("GEMINI_BUILDER_MODEL", planner) }
}

/** Role key the agents pass to the model provider. It is not sent to the API. */
export const PLANNER_MODEL = "planner"
/** Role key the agents pass to the model provider. It is not sent to the API. */
export const BUILDER_MODEL = "builder"

function modelId(provider: AiProviderName, role: ModelRole) {
  return providerModels(provider)[role]
}

/** Planner model id actually sent to the primary provider. */
export const PRIMARY_PLANNER_MODEL = modelId(PRIMARY_PROVIDER, "planner")
/** Builder model id actually sent to the primary provider. */
export const PRIMARY_BUILDER_MODEL = modelId(PRIMARY_PROVIDER, "builder")

/** The most screens a plan can have on any AppForge plan, even when the person asks for more. */
export const MAX_PLAN_SCREENS = PLANS.pro.maxScreens

/** How many screens a plan has at most, unless the person asks for more. */
export const DEFAULT_SCREEN_COUNT = (() => {
  const count = Number.parseInt(process.env.DEFAULT_SCREEN_COUNT ?? "", 10)
  return Number.isNaN(count) ? 3 : Math.min(Math.max(count, 1), MAX_PLAN_SCREENS)
})()

let configured = false

const AI_ATTEMPTS = 5

/** CloudHike answers 503 while a stream is busy and 429 past 20 requests a minute. Wait, then try again. */
function fetchWithBackoff(provider: string) {
  return async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    for (let attempt = 0; attempt < AI_ATTEMPTS; attempt++) {
      const response = await fetch(input, init)
      const retry = response.status === 429 || response.status === 503
      if (!retry || attempt === AI_ATTEMPTS - 1) return response
      const retryAfter = Number(response.headers.get("retry-after"))
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : (attempt + 1) * 8000
      await response.arrayBuffer().catch(() => undefined)
      console.warn(`${provider} returned ${response.status}. Waiting ${Math.round(waitMs / 1000)}s, then retrying.`)
      await new Promise((resolve) => setTimeout(resolve, waitMs))
    }
    throw new Error(`${provider} did not answer.`)
  }
}

function errorSummary(error: unknown) {
  if (error instanceof APIError) {
    const status = error.status ?? "network"
    return `${status} ${error.message}`.slice(0, 300)
  }
  if (error instanceof Error) return error.message.slice(0, 300)
  return "unknown error"
}

/** Provider outages and rejected requests can be retried on the fallback. A cancelled run cannot. */
function shouldFallback(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return false
  if (error instanceof APIUserAbortError) return false
  if (error instanceof Error && error.name === "AbortError") return false
  if (error instanceof APIError) return error.status == null || error.status >= 400
  return error instanceof TypeError
}

function fallbackFailure(primary: unknown, fallback: unknown, fallbackName: string) {
  const error = new Error(
    `Primary model failed (${errorSummary(primary)}). ${FALLBACK_PROVIDER} fallback (${fallbackName}) failed (${errorSummary(fallback)}).`
  )
  error.cause = fallback
  return error
}

/** Tries the primary provider, then the fallback provider if that call fails before any output. */
class FallbackChatModel implements Model {
  constructor(
    private readonly primary: Model,
    private readonly fallback: Model,
    private readonly primaryName: string,
    private readonly fallbackName: string
  ) {}

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    try {
      return await this.primary.getResponse(request)
    } catch (error) {
      if (!shouldFallback(error, request.signal)) throw error
      console.warn(
        `${this.primaryName} failed (${errorSummary(error)}). Falling back to ${FALLBACK_PROVIDER} (${this.fallbackName}).`
      )
      try {
        return await this.fallback.getResponse(request)
      } catch (fallbackError) {
        throw fallbackFailure(error, fallbackError, this.fallbackName)
      }
    }
  }

  async *getStreamedResponse(request: ModelRequest) {
    let started = false
    try {
      for await (const event of this.primary.getStreamedResponse(request)) {
        started = true
        yield event
      }
    } catch (error) {
      if (started || !shouldFallback(error, request.signal)) throw error
      console.warn(
        `${this.primaryName} failed (${errorSummary(error)}). Falling back to ${FALLBACK_PROVIDER} (${this.fallbackName}).`
      )
      try {
        yield* this.fallback.getStreamedResponse(request)
      } catch (fallbackError) {
        throw fallbackFailure(error, fallbackError, this.fallbackName)
      }
    }
  }
}

function cloudhikeClient() {
  const baseURL = process.env.AI_BASE_URL?.trim()
  const apiKey = process.env.AI_API_KEY?.trim()
  if (!baseURL || !apiKey) {
    throw new Error("AI_BASE_URL and AI_API_KEY must be set to use CloudHike.")
  }
  return new OpenAI({
    baseURL,
    apiKey,
    maxRetries: 0,
    fetch: fetchWithBackoff("CloudHike AI"),
  })
}

function geminiClient() {
  const apiKey = googleAiApiKey()
  if (!apiKey) {
    throw new Error("GOOGLE_AI_API_KEY must be set to use Gemini.")
  }
  return new OpenAI({
    baseURL: GOOGLE_AI_BASE_URL,
    apiKey,
    maxRetries: 0,
    fetch: fetchWithBackoff("Google AI"),
  })
}

function clientFor(provider: AiProviderName) {
  return provider === "cloudhike" ? cloudhikeClient() : geminiClient()
}

export function configureAgents() {
  if (configured) return
  const primaryClient = clientFor(PRIMARY_PROVIDER)
  const fallbackClient = FALLBACK_PROVIDER === "none" ? null : clientFor(FALLBACK_PROVIDER)
  const fallbackLabel =
    FALLBACK_PROVIDER === "none"
      ? "none"
      : `${FALLBACK_PROVIDER} (planner ${modelId(FALLBACK_PROVIDER, "planner")}, builder ${modelId(FALLBACK_PROVIDER, "builder")})`
  console.info(
    `AI primary is ${PRIMARY_PROVIDER} (planner ${PRIMARY_PLANNER_MODEL}, builder ${PRIMARY_BUILDER_MODEL}). Fallback is ${fallbackLabel}.`
  )
  setDefaultOpenAIClient(primaryClient)
  setOpenAIAPI("chat_completions")
  setTracingDisabled(true)

  const primary = new OpenAIProvider({ openAIClient: primaryClient, useResponses: false })
  const fallback = fallbackClient
    ? new OpenAIProvider({ openAIClient: fallbackClient, useResponses: false })
    : null
  setDefaultModelProvider({
    async getModel(modelName) {
      const role: ModelRole = modelName === BUILDER_MODEL ? "builder" : "planner"
      const primaryId = modelId(PRIMARY_PROVIDER, role)
      const model = await primary.getModel(primaryId)
      if (!fallback || FALLBACK_PROVIDER === "none") return model
      const fallbackId = modelId(FALLBACK_PROVIDER, role)
      return new FallbackChatModel(model, await fallback.getModel(fallbackId), primaryId, fallbackId)
    },
  })

  configured = true
}
