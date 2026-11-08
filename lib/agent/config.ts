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

export function configureAgents() {
  if (configured) return
  if (!process.env.AI_BASE_URL || !process.env.AI_API_KEY) {
    throw new Error("AI_BASE_URL and AI_API_KEY must be set to run the AppForge agent.")
  }
  setDefaultOpenAIClient(
    new OpenAI({ baseURL: process.env.AI_BASE_URL, apiKey: process.env.AI_API_KEY })
  )
  setOpenAIAPI("chat_completions")
  setTracingDisabled(true)
  configured = true
}
