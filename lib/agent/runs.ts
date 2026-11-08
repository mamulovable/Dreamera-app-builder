import type { AgentEvent } from "@/lib/agent-protocol"

type Listener = (event: AgentEvent) => void

/**
 * One agent run for a project. The run keeps going if the browser disconnects,
 * and a reloaded workspace can attach to it again: `subscribe` first replays
 * the in-progress state (status, streamed text, partial code) and then forwards
 * new events.
 *
 * Runs live in this server process's memory, so this assumes one long-lived
 * Node server (as with `next dev` / `next start`).
 */
export class ProjectRun {
  private listeners = new Set<Listener>()
  private status: string | null = null
  private text = ""
  private reasoning = ""
  private code: { screenId: string; text: string } | null = null

  emit(event: AgentEvent) {
    switch (event.type) {
      case "status":
        this.status = event.label
        break
      case "reasoning-delta":
        this.reasoning += event.delta
        break
      case "text-delta":
        this.text += event.delta
        break
      case "message":
        this.text = ""
        this.reasoning = ""
        break
      case "screen":
        this.code = event.screen.status === "generating" ? { screenId: event.screen.id, text: "" } : null
        break
      case "code-delta":
        if (this.code?.screenId === event.screenId) this.code.text += event.delta
        break
    }
    for (const listener of this.listeners) listener(event)
  }

  subscribe(listener: Listener) {
    if (this.status) listener({ type: "status", label: this.status })
    if (this.reasoning) listener({ type: "reasoning-delta", delta: this.reasoning })
    if (this.text) listener({ type: "text-delta", delta: this.text })
    if (this.code?.text) listener({ type: "code-delta", screenId: this.code.screenId, delta: this.code.text })
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

const globalForRuns = globalThis as unknown as { appforgeRuns?: Map<string, ProjectRun> }
const runs = (globalForRuns.appforgeRuns ??= new Map())

export function getRun(projectId: string) {
  return runs.get(projectId)
}

/**
 * Starts `work` as the project's run. Callers subscribe to the returned run
 * before the work begins, so no event is missed. Always ends with a `done` event.
 * If another request started a run for the project in the meantime, that run is returned instead.
 */
export function startRun(projectId: string, work: (run: ProjectRun) => Promise<void>) {
  const existing = runs.get(projectId)
  if (existing) return existing
  const run = new ProjectRun()
  runs.set(projectId, run)
  queueMicrotask(async () => {
    try {
      await work(run)
    } catch (error) {
      console.error("Agent run failed", error)
      run.emit({ type: "status", label: null })
      run.emit({ type: "error", message: "Something went wrong while the agent was working. Please try again." })
    } finally {
      runs.delete(projectId)
      run.emit({ type: "done" })
    }
  })
  return run
}
