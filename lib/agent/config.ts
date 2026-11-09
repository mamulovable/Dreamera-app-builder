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

// The OpenAI Agents SDK talks to CloudHike's OpenAI-compatible endpoint.
// It serves Chat Completions (not the Responses API), and traces would go to
// OpenAI's dashboard, so both are configured here once per process. If a call
// fails before any output, the same request is sent to Gemini on Google AI.

const DEFAULT_MODEL = "claude-sonnet-5-5"
const DEFAULT_FALLBACK_MODEL = "gemini-3.8-flash"
const GOOGLE_AI_BASE_URL =
  process.env.GOOGLE_AI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai/"

function modelFromEnv(name: string, fallback: string) {
  const value = process.env[name]?.trim()
  return value || fallback
}

/** Model for understanding the request, planning, and chatting. Set with AI_MODEL. */
export const PLANNER_MODEL = modelFromEnv("AI_MODEL", DEFAULT_MODEL)
/** Model for writing screen code. Set with AI_BUILDER_MODEL. Defaults to the planner model. */
export const BUILDER_MODEL = modelFromEnv("AI_BUILDER_MODEL", PLANNER_MODEL)
/** Used when the planner or builder model fails. Set with AI_FALLBACK_MODEL. */
export const FALLBACK_MODEL = modelFromEnv("AI_FALLBACK_MODEL", DEFAULT_FALLBACK_MODEL)

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

function googleAiApiKey() {
  const key = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY
  const trimmed = key?.trim()
  return trimmed ? trimmed : undefined
}

function errorSummary(error: unknown) {
  if (error instanceof APIError) {
    const status = error.status ?? "network"
    return `${status} ${error.message}`.slice(0, 300)
  }
  if (error instanceof Error) return error.message.slice(0, 300)
  return "unknown error"
}

/** Provider outages and rejected requests can be retried on Gemini. A cancelled run cannot. */
function shouldFallback(error: unknown, signal?: AbortSignal) {
  if (signal?.aborted) return false
  if (error instanceof APIUserAbortError) return false
  if (error instanceof Error && error.name === "AbortError") return false
  if (error instanceof APIError) return error.status == null || error.status >= 400
  return error instanceof TypeError
}

function fallbackFailure(primary: unknown, fallback: unknown) {
  const error = new Error(
    `Primary model failed (${errorSummary(primary)}). ${FALLBACK_MODEL} fallback failed (${errorSummary(fallback)}).`
  )
  error.cause = fallback
  return error
}

/** Tries the CloudHike model, then Gemini on Google AI if that call fails before any output. */
class FallbackChatModel implements Model {
  constructor(
    private readonly primary: Model,
    private readonly fallback: Model,
    private readonly primaryName: string
  ) {}

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    try {
      return await this.primary.getResponse(request)
    } catch (error) {
      if (!shouldFallback(error, request.signal)) throw error
      console.warn(`${this.primaryName} failed (${errorSummary(error)}). Falling back to ${FALLBACK_MODEL}.`)
      try {
        return await this.fallback.getResponse(request)
      } catch (fallbackError) {
        throw fallbackFailure(error, fallbackError)
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
      console.warn(`${this.primaryName} failed (${errorSummary(error)}). Falling back to ${FALLBACK_MODEL}.`)
      try {
        yield* this.fallback.getStreamedResponse(request)
      } catch (fallbackError) {
        throw fallbackFailure(error, fallbackError)
      }
    }
  }
}

export function configureAgents() {
  if (configured) return
  if (!process.env.AI_BASE_URL || !process.env.AI_API_KEY) {
    throw new Error("AI_BASE_URL and AI_API_KEY must be set to run the AppForge agent.")
  }
  const client = new OpenAI({
    baseURL: process.env.AI_BASE_URL,
    apiKey: process.env.AI_API_KEY,
    maxRetries: 0,
    fetch: fetchWithBackoff("CloudHike AI"),
  })
  setDefaultOpenAIClient(client)
  setOpenAIAPI("chat_completions")
  setTracingDisabled(true)

  const googleKey = googleAiApiKey()
  if (googleKey) {
    const primary = new OpenAIProvider({ openAIClient: client, useResponses: false })
    const fallback = new OpenAIProvider({
      useResponses: false,
      openAIClient: new OpenAI({
        baseURL: GOOGLE_AI_BASE_URL,
        apiKey: googleKey,
        maxRetries: 0,
        fetch: fetchWithBackoff("Google AI"),
      }),
    })
    const covered = new Set([PLANNER_MODEL, BUILDER_MODEL])
    setDefaultModelProvider({
      async getModel(modelName) {
        const name = modelName || PLANNER_MODEL
        const model = await primary.getModel(name)
        if (!covered.has(name)) return model
        return new FallbackChatModel(model, await fallback.getModel(FALLBACK_MODEL), name)
      },
    })
  }

  configured = true
}
