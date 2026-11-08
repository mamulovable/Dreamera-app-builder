"use client"

import * as React from "react"

import {
  componentFilePath,
  messageWithElement,
  type AgentEvent,
  type AgentRequest,
  type AppPlan,
  type ChatMessage,
  type ProjectScreen,
} from "@/lib/agent-protocol"
import type { BackendStatus } from "@/lib/backend-protocol"
import { isUpgradeReason } from "@/lib/plans"
import type { ProjectStatus } from "@/lib/projects"
import { useUpgradeDialog } from "@/components/billing/upgrade-dialog"

export type AgentState = {
  messages: ChatMessage[]
  status: ProjectStatus
  plan: AppPlan | null
  screens: ProjectScreen[]
  backend: BackendStatus
  /** True while a request to the agent is open. */
  busy: boolean
  /** What the agent is doing right now, e.g. "Drafting the screen plan…". */
  activity: string | null
  /** The reply being written, before it's saved. */
  streamingText: string
  reasoning: string
  error: string | null
  /** True once a new session started here, which took the first prompt out of the chat. */
  sessionRestarted: boolean
}

type Action =
  | { type: "begin"; optimistic?: ChatMessage }
  | { type: "reconnect" }
  | { type: "event"; event: AgentEvent }
  | { type: "fail"; message: string; removeId?: string }
  | { type: "end" }
  | { type: "theme"; themeId: string }
  | { type: "theme-failed"; themeId: string; message: string }
  | { type: "backend-changed"; backend: BackendStatus; plan: AppPlan | null }
  | { type: "new-session" }
  | { type: "file-code"; path: string; code: string }

function reducer(state: AgentState, action: Action): AgentState {
  switch (action.type) {
    case "begin":
      return {
        ...state,
        busy: true,
        error: null,
        messages: action.optimistic ? [...state.messages, action.optimistic] : state.messages,
      }
    case "reconnect":
      // The agent replays what's in progress when we attach again.
      return { ...state, streamingText: "", reasoning: "" }
    case "fail":
      return {
        ...state,
        error: action.message,
        activity: null,
        streamingText: "",
        reasoning: "",
        messages: action.removeId ? state.messages.filter((m) => m.id !== action.removeId) : state.messages,
      }
    case "end":
      return { ...state, busy: false, activity: null }
    case "event":
      return applyEvent(state, action.event)
    case "theme":
      return withActiveTheme(state, action.themeId)
    case "theme-failed":
      return { ...withActiveTheme(state, action.themeId), error: action.message }
    case "backend-changed":
      return { ...state, backend: action.backend, plan: action.plan }
    case "new-session":
      return { ...state, messages: [], streamingText: "", reasoning: "", error: null, sessionRestarted: true }
    case "file-code":
      return {
        ...state,
        screens: state.screens.map((s) => (s.filePath === action.path ? { ...s, code: action.code } : s)),
        plan: state.plan && {
          ...state.plan,
          components: state.plan.components?.map((c) => (componentFilePath(c.name) === action.path ? { ...c, code: action.code } : c)),
        },
      }
  }
}

function withActiveTheme(state: AgentState, activeThemeId: string): AgentState {
  if (!state.plan?.themePackage) return state
  return { ...state, plan: { ...state.plan, themePackage: { ...state.plan.themePackage, activeThemeId } } }
}

function applyEvent(state: AgentState, event: AgentEvent): AgentState {
  switch (event.type) {
    case "status":
      return { ...state, activity: event.label }
    case "reasoning-delta":
      return { ...state, reasoning: state.reasoning + event.delta }
    case "text-delta":
      return { ...state, streamingText: state.streamingText + event.delta }
    case "message":
      return {
        ...state,
        // A build's events replay from the beginning, so this message may be here already.
        messages: state.messages.some((m) => m.id === event.message.id)
          ? state.messages
          : [...state.messages, event.message],
        streamingText: "",
        reasoning: "",
      }
    case "plan":
      return { ...state, plan: event.plan }
    case "backend":
      return { ...state, backend: event.backend }
    case "project-status":
      return { ...state, status: event.status }
    case "screens":
      return { ...state, screens: event.screens }
    case "screen":
      return {
        ...state,
        screens: state.screens.map((s) => (s.id === event.screen.id ? event.screen : s)),
      }
    case "code-delta":
      return {
        ...state,
        screens: state.screens.map((s) =>
          s.id === event.screenId ? { ...s, code: (s.code ?? "") + event.delta } : s
        ),
      }
    case "error":
      return { ...state, error: event.message, activity: null, streamingText: "", reasoning: "" }
    case "upgrade":
    case "done":
      return state
  }
}

const MAX_RECONNECTS = 5

/** Reads a stream of events to its end. Returns whether the agent finished, rather than the connection dropping. */
async function readEvents(body: NonNullable<Response["body"]>, onEvent: (event: AgentEvent) => void) {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ""
  let finished = false
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return finished
      buffer += value
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      for (const line of lines) {
        if (!line.trim()) continue
        const event = JSON.parse(line) as AgentEvent
        if (event.type === "done") finished = true
        onEvent(event)
      }
    }
  } catch {
    return false
  }
}

/**
 * Talks to the project's agent: sends requests, reads the streamed events, and
 * keeps the chat, plan, and screens up to date. On mount it picks up any work
 * that's waiting, like a fresh prompt from the home page or an unfinished build.
 */
export function useProjectAgent(
  projectId: string,
  initial: Pick<AgentState, "messages" | "status" | "plan" | "screens" | "backend">,
  readOnly = false
) {
  const [state, dispatch] = React.useReducer(reducer, {
    ...initial,
    busy: false,
    activity: null,
    streamingText: "",
    reasoning: "",
    error: null,
    sessionRestarted: false,
  })
  const busyRef = React.useRef(false)
  const openUpgrade = useUpgradeDialog()

  const send = React.useCallback(
    async (request: AgentRequest): Promise<boolean> => {
      if (busyRef.current) return false
      busyRef.current = true
      const optimistic =
        request.action === "message"
          ? {
              id: `local-${Date.now()}`,
              role: "user" as const,
              content: request.element ? messageWithElement(request.content, request.element) : request.content,
            }
          : request.action === "confirm"
            ? { id: `local-${Date.now()}`, role: "user" as const, content: "Looks good, build it!" }
            : undefined
      dispatch({ type: "begin", optimistic })

      try {
        let response = await fetch(`/api/projects/${projectId}/agent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        })
        if (!response.ok || !response.body) {
          const body = await response.json().catch(() => null)
          if (isUpgradeReason(body?.code)) openUpgrade(body.code)
          dispatch({
            type: "fail",
            message: body?.error ?? "The agent couldn't start. Please try again.",
            removeId: optimistic?.id,
          })
          return false
        }

        // Long streams can drop. The work carries on on the server, so attach to it again.
        for (let attempt = 0; ; attempt++) {
          const onEvent = (event: AgentEvent) => {
            if (event.type === "upgrade") openUpgrade(event.reason)
            dispatch({ type: "event", event })
          }
          if (await readEvents(response.body, onEvent)) return true
          if (attempt === MAX_RECONNECTS) throw new Error("Lost the connection.")
          await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)))
          dispatch({ type: "reconnect" })
          response = await fetch(`/api/projects/${projectId}/agent`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "start" }),
          })
          if (!response.ok || !response.body) throw new Error("Couldn't attach again.")
        }
      } catch {
        dispatch({
          type: "fail",
          message: "Lost the connection to the agent. Reload the page to see its latest progress.",
        })
        return false
      } finally {
        busyRef.current = false
        dispatch({ type: "end" })
      }
    },
    [openUpgrade, projectId]
  )

  // Start (or reattach to) the agent once when the workspace opens.
  const started = React.useRef(false)
  React.useEffect(() => {
    // Only the owner runs the agent. Someone the project was shared with sees it as it was when the page loaded.
    if (started.current || readOnly) return
    started.current = true
    const last = initial.messages.at(-1)
    if (initial.status === "building" || (initial.status === "planning" && last?.role === "user")) {
      void send({ action: "start" })
    }
  }, [initial.messages, initial.status, readOnly, send])

  /** Switches the app's theme right away, and goes back if it can't be saved. */
  const planRef = React.useRef(state.plan)
  React.useEffect(() => {
    planRef.current = state.plan
  })
  const setTheme = React.useCallback(
    async (themeId: string) => {
      const previous = planRef.current?.themePackage?.activeThemeId
      if (!previous || previous === themeId) return
      dispatch({ type: "theme", themeId })
      const response = await fetch(`/api/projects/${projectId}/theme`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId }),
      }).catch(() => null)
      if (!response?.ok) {
        dispatch({ type: "theme-failed", themeId: previous, message: "Couldn't save the theme. Please try again." })
      }
    },
    [projectId]
  )

  /** Connects this app to the account the person already connected, or disconnects it. */
  const changeBackend = React.useCallback(
    async (method: "POST" | "DELETE") => {
      const response = await fetch(`/api/projects/${projectId}/backend`, { method }).catch(() => null)
      if (!response?.ok) return false
      const plan = planRef.current
      const next = method === "DELETE" && plan ? { ...plan, backend: null } : plan
      dispatch({ type: "backend-changed", backend: (await response.json()) as BackendStatus, plan: next })
      return true
    },
    [projectId]
  )

  /** Clears the chat and what the agent remembers of it. The app and its plan stay as they are. */
  const startNewSession = React.useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    const response = await fetch(`/api/projects/${projectId}/session`, { method: "POST" }).catch(() => null)
    busyRef.current = false
    if (response?.ok) return dispatch({ type: "new-session" })
    const body = await response?.json().catch(() => null)
    dispatch({ type: "fail", message: body?.error ?? "Couldn't start a new session. Please try again." })
  }, [projectId])

  /** Shows a file's latest code, after an edit made by hand. */
  const setFileCode = React.useCallback((path: string, code: string) => dispatch({ type: "file-code", path, code }), [])

  return { ...state, send, setTheme, changeBackend, startNewSession, setFileCode }
}
