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
  type ModelRetryAdviceRequest,
} from "@openai/agents"

import { recordBuilderCall, type BuilderUsage } from "@/lib/agent/call-log"
import {
  cloudhikeCredentials,
  envModels,
  envPrimary,
  geminiCredentials,
  openrouterCredentials,
  providerReady,
  readBuilderRoute,
  type AiProviderName,
} from "@/lib/agent/provider-settings"
import { PLANS } from "@/lib/plans"

// The OpenAI Agents SDK talks to an OpenAI-compatible endpoint: CloudHike,
// Gemini on Google AI, or OpenRouter. All serve Chat Completions (not the
// Responses API), and traces would go to OpenAI's dashboard. The admin builder
// page chooses which provider runs first, and which model ids to send. The env
// values are the default. If that call fails before any output, the same
// request is sent to the fallback.

type ModelRole = "planner" | "builder"

/** Role key the agents pass to the model provider. It is not sent to the API. */
export const PLANNER_MODEL = "planner"
/** Role key the agents pass to the model provider. It is not sent to the API. */
export const BUILDER_MODEL = "builder"

/** Builder model id the next build will send to the current primary provider. */
export async function activeBuilderModel() {
  const route = await readBuilderRoute()
  return route.builderModel
}

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

function fallbackFailure(primary: unknown, fallback: unknown, fallbackProvider: string, fallbackName: string) {
  const error = new Error(
    `Primary model failed (${errorSummary(primary)}). ${fallbackProvider} fallback (${fallbackName}) failed (${errorSummary(fallback)}).`
  )
  error.cause = fallback
  return error
}

function usageOf(event: unknown): BuilderUsage | null {
  if (!event || typeof event !== "object" || (event as { type?: unknown }).type !== "response_done") return null
  const usage = (event as { response?: { usage?: BuilderUsage } }).response?.usage
  return usage ?? null
}

/** Records input and output tokens for one model call, then forwards it. */
class UsageLoggingModel implements Model {
  constructor(
    private readonly inner: Model,
    private readonly provider: string,
    private readonly model: string,
    private readonly role: ModelRole
  ) {}

  getRetryAdvice(args: ModelRetryAdviceRequest) {
    return this.inner.getRetryAdvice?.(args)
  }

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    const started = Date.now()
    try {
      const response = await this.inner.getResponse(request)
      await recordBuilderCall({
        provider: this.provider,
        model: this.model,
        role: this.role,
        usage: response.usage,
        status: "succeeded",
        durationMs: Date.now() - started,
      })
      return response
    } catch (error) {
      await recordBuilderCall({
        provider: this.provider,
        model: this.model,
        role: this.role,
        usage: null,
        status: "failed",
        error: errorSummary(error),
        durationMs: Date.now() - started,
      })
      throw error
    }
  }

  async *getStreamedResponse(request: ModelRequest) {
    const started = Date.now()
    let logged = false
    try {
      for await (const event of this.inner.getStreamedResponse(request)) {
        const usage = usageOf(event)
        if (usage) {
          logged = true
          await recordBuilderCall({
            provider: this.provider,
            model: this.model,
            role: this.role,
            usage,
            status: "succeeded",
            durationMs: Date.now() - started,
          })
        }
        yield event
      }
    } catch (error) {
      if (!logged) {
        await recordBuilderCall({
          provider: this.provider,
          model: this.model,
          role: this.role,
          usage: null,
          status: "failed",
          error: errorSummary(error),
          durationMs: Date.now() - started,
        })
      }
      throw error
    }
  }
}

/** Tries the primary provider, then the fallback provider if that call fails before any output. */
class FallbackChatModel implements Model {
  constructor(
    private readonly primary: Model,
    private readonly fallback: Model,
    private readonly primaryName: string,
    private readonly fallbackProvider: string,
    private readonly fallbackName: string
  ) {}

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    try {
      return await this.primary.getResponse(request)
    } catch (error) {
      if (!shouldFallback(error, request.signal)) throw error
      console.warn(
        `${this.primaryName} failed (${errorSummary(error)}). Falling back to ${this.fallbackProvider} (${this.fallbackName}).`
      )
      try {
        return await this.fallback.getResponse(request)
      } catch (fallbackError) {
        throw fallbackFailure(error, fallbackError, this.fallbackProvider, this.fallbackName)
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
        `${this.primaryName} failed (${errorSummary(error)}). Falling back to ${this.fallbackProvider} (${this.fallbackName}).`
      )
      try {
        yield* this.fallback.getStreamedResponse(request)
      } catch (fallbackError) {
        throw fallbackFailure(error, fallbackError, this.fallbackProvider, this.fallbackName)
      }
    }
  }
}

function cloudhikeClient() {
  const credentials = cloudhikeCredentials()
  if (!credentials) throw new Error("AI_BASE_URL and AI_API_KEY must be set to use CloudHike.")
  return new OpenAI({
    baseURL: credentials.baseURL,
    apiKey: credentials.apiKey,
    maxRetries: 0,
    fetch: fetchWithBackoff("CloudHike AI"),
  })
}

function geminiClient() {
  const credentials = geminiCredentials()
  if (!credentials) throw new Error("GOOGLE_AI_API_KEY must be set to use Gemini.")
  return new OpenAI({
    baseURL: credentials.baseURL,
    apiKey: credentials.apiKey,
    maxRetries: 0,
    fetch: fetchWithBackoff("Google AI"),
  })
}

function openrouterClient() {
  const credentials = openrouterCredentials()
  if (!credentials) throw new Error("OPENROUTER_API_KEY must be set to use OpenRouter.")
  const referer = process.env.NEXT_PUBLIC_APP_URL?.trim()
  return new OpenAI({
    baseURL: credentials.baseURL,
    apiKey: credentials.apiKey,
    maxRetries: 0,
    defaultHeaders: {
      ...(referer ? { "HTTP-Referer": referer } : {}),
      "X-Title": "AppForge",
    },
    fetch: fetchWithBackoff("OpenRouter"),
  })
}

export function configureAgents() {
  if (configured) return
  const clients: Record<AiProviderName, OpenAI | null> = {
    cloudhike: providerReady("cloudhike") ? cloudhikeClient() : null,
    gemini: providerReady("gemini") ? geminiClient() : null,
    openrouter: providerReady("openrouter") ? openrouterClient() : null,
  }
  const adapters: Record<AiProviderName, OpenAIProvider | null> = {
    cloudhike: clients.cloudhike ? new OpenAIProvider({ openAIClient: clients.cloudhike, useResponses: false }) : null,
    gemini: clients.gemini ? new OpenAIProvider({ openAIClient: clients.gemini, useResponses: false }) : null,
    openrouter: clients.openrouter ? new OpenAIProvider({ openAIClient: clients.openrouter, useResponses: false }) : null,
  }
  const defaultClient = clients[envPrimary()] ?? clients.cloudhike ?? clients.gemini ?? clients.openrouter
  if (defaultClient) setDefaultOpenAIClient(defaultClient)
  setOpenAIAPI("chat_completions")
  setTracingDisabled(true)
  console.info("AI provider follows the admin builder setting. Env defaults apply until an admin switches it.")

  setDefaultModelProvider({
    async getModel(modelName) {
      const role: ModelRole = modelName === BUILDER_MODEL ? "builder" : "planner"
      const route = await readBuilderRoute()
      const adapter = adapters[route.primary]
      if (!adapter) throw new Error(`${route.primary} isn't configured. Set its API key, or switch the builder provider in admin.`)
      const primaryId = role === "builder" ? route.builderModel : route.plannerModel
      const model = new UsageLoggingModel(await adapter.getModel(primaryId), route.primary, primaryId, role)
      if (route.fallback === "none") return model
      const fallbackAdapter = adapters[route.fallback]
      if (!fallbackAdapter) return model
      const fallbackDefaults = envModels(route.fallback)
      const fallbackOverride = route.overrides[route.fallback]
      const fallbackId =
        (role === "builder" ? fallbackOverride.builder : fallbackOverride.planner) ||
        (role === "builder" ? fallbackDefaults.builder : fallbackDefaults.planner)
      const fallbackModel = new UsageLoggingModel(await fallbackAdapter.getModel(fallbackId), route.fallback, fallbackId, role)
      return new FallbackChatModel(model, fallbackModel, primaryId, route.fallback, fallbackId)
    },
  })

  configured = true
}
