import OpenAI from "openai"
import { setDefaultOpenAIClient, setOpenAIAPI, setTracingDisabled } from "@openai/agents"

import { PLANS } from "@/lib/plans"

// The OpenAI Agents SDK talks to Google AI's OpenAI-compatible Gemini endpoint.
// It serves Chat Completions (not the Responses API), and traces would go to
// OpenAI's dashboard, so both are configured here once per process.

const GEMINI_MODEL = "gemini-3.8-flash"
const GOOGLE_AI_BASE_URL =
  process.env.GOOGLE_AI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai/"

/** Model for understanding the request, planning, and chatting. Gemini 3.8 Flash for now. */
export const PLANNER_MODEL = GEMINI_MODEL
/** Model for writing screen code. Same model as the planner for now. */
export const BUILDER_MODEL = GEMINI_MODEL

/** The most screens a plan can have on any AppForge plan, even when the person asks for more. */
export const MAX_PLAN_SCREENS = PLANS.pro.maxScreens

/** How many screens a plan has at most, unless the person asks for more. */
export const DEFAULT_SCREEN_COUNT = (() => {
  const count = Number.parseInt(process.env.DEFAULT_SCREEN_COUNT ?? "", 10)
  return Number.isNaN(count) ? 3 : Math.min(Math.max(count, 1), MAX_PLAN_SCREENS)
})()

let configured = false

const AI_ATTEMPTS = 5

/** Google AI answers 429 when the rate limit is hit and 503 while it is busy. Wait, then try again. */
async function fetchWithBackoff(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt < AI_ATTEMPTS; attempt++) {
    const response = await fetch(input, init)
    const retry = response.status === 429 || response.status === 503
    if (!retry || attempt === AI_ATTEMPTS - 1) return response
    const retryAfter = Number(response.headers.get("retry-after"))
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : (attempt + 1) * 8000
    await response.arrayBuffer().catch(() => undefined)
    console.warn(`Google AI returned ${response.status}. Waiting ${Math.round(waitMs / 1000)}s, then retrying.`)
    await new Promise((resolve) => setTimeout(resolve, waitMs))
  }
  throw new Error("Google AI did not answer.")
}

function googleAiApiKey() {
  const key = process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY
  const trimmed = key?.trim()
  return trimmed ? trimmed : undefined
}

export function configureAgents() {
  if (configured) return
  const apiKey = googleAiApiKey()
  if (!apiKey) {
    throw new Error("GOOGLE_AI_API_KEY must be set to run the AppForge agent.")
  }
  setDefaultOpenAIClient(
    new OpenAI({
      baseURL: GOOGLE_AI_BASE_URL,
      apiKey,
      maxRetries: 0,
      fetch: fetchWithBackoff,
    })
  )
  setOpenAIAPI("chat_completions")
  setTracingDisabled(true)
  configured = true
}
