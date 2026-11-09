import OpenAI from "openai"
import { setDefaultOpenAIClient, setOpenAIAPI, setTracingDisabled } from "@openai/agents"

import { PLANS } from "@/lib/plans"

// The OpenAI Agents SDK talks to Anthropic's OpenAI-compatible endpoint
// (https://api.anthropic.com/v1/). It serves Chat Completions (not the
// Responses API), and traces would go to OpenAI's dashboard, so both are
// configured here once per process.

const DEFAULT_MODEL = "claude-sonnet-5-5"

/** Model for understanding the request, planning, and chatting. */
export const PLANNER_MODEL = process.env.AI_MODEL || DEFAULT_MODEL
/** Model for writing screen code. */
export const BUILDER_MODEL = process.env.AI_BUILDER_MODEL || PLANNER_MODEL

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
async function fetchWithBackoff(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt < AI_ATTEMPTS; attempt++) {
    const response = await fetch(input, init)
    const retry = response.status === 429 || response.status === 503
    if (!retry || attempt === AI_ATTEMPTS - 1) return response
    const retryAfter = Number(response.headers.get("retry-after"))
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : (attempt + 1) * 8000
    await response.arrayBuffer().catch(() => undefined)
    console.warn(`CloudHike AI returned ${response.status}. Waiting ${Math.round(waitMs / 1000)}s, then retrying.`)
    await new Promise((resolve) => setTimeout(resolve, waitMs))
  }
  throw new Error("CloudHike AI did not answer.")
}

export function configureAgents() {
  if (configured) return
  if (!process.env.AI_BASE_URL || !process.env.AI_API_KEY) {
    throw new Error("AI_BASE_URL and AI_API_KEY must be set to run the AppForge agent.")
  }
  setDefaultOpenAIClient(
    new OpenAI({
      baseURL: process.env.AI_BASE_URL,
      apiKey: process.env.AI_API_KEY,
      maxRetries: 0,
      fetch: fetchWithBackoff,
    })
  )
  setOpenAIAPI("chat_completions")
  setTracingDisabled(true)
  configured = true
}
