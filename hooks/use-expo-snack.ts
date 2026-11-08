"use client"

import * as React from "react"
import type { Snack, SnackState } from "snack-sdk"

import type { AppPlan, ProjectScreen } from "@/lib/agent-protocol"
import { SNACK_SDK_VERSION, snackProject } from "@/lib/generated-app/snack-project"

/** How long code waits before going to the phone, so several quick edits arrive as one. */
const CODE_CHANGES_DELAY_MS = 500

export type ExpoDevice = { id: string; name: string; platform: string; error: string | null }

export type ExpoSnackStatus =
  | { state: "idle" | "starting" }
  | { state: "ready"; url: string; devices: ExpoDevice[]; problem: string | null }
  | { state: "error"; message: string }

function readStatus(state: SnackState): ExpoSnackStatus {
  const problem = Object.entries(state.dependencies).find(([, dependency]) => dependency.error)
  return {
    state: "ready",
    url: state.url,
    devices: Object.entries(state.connectedClients).map(([id, client]) => ({
      id,
      name: client.name,
      platform: client.platform,
      error: client.error?.message ?? null,
    })),
    problem: problem ? `Couldn't load ${problem[0]}: ${problem[1].error!.message}` : null,
  }
}

/**
 * Keeps the app online as a Snack from this browser tab, once `enabled`. Every change to
 * the code goes straight to the phones connected to it, so it stays online until the tab closes.
 */
export function useExpoSnack(plan: AppPlan | null, screens: ProjectScreen[], enabled: boolean) {
  const [status, setStatus] = React.useState<ExpoSnackStatus>({ state: "idle" })
  const [attempt, setAttempt] = React.useState(0)
  const snackRef = React.useRef<Snack | null>(null)
  const sentFiles = React.useRef<string[]>([])

  const project = React.useMemo(() => snackProject(plan, screens), [plan, screens])
  const hasProject = project !== null
  const latest = React.useRef(project)
  React.useEffect(() => {
    latest.current = project
  })

  React.useEffect(() => {
    if (!enabled || !hasProject) return
    let active = true
    let unsubscribe: (() => void) | undefined
    setStatus({ state: "starting" })

    void (async () => {
      try {
        const { Snack } = await import("snack-sdk")
        if (!active) return
        const { files, dependencies } = latest.current!
        const snack = new Snack({
          sdkVersion: SNACK_SDK_VERSION,
          name: "AppForge preview",
          files,
          dependencies,
          codeChangesDelay: CODE_CHANGES_DELAY_MS,
        })
        snackRef.current = snack
        sentFiles.current = Object.keys(files)
        snack.setOnline(true)

        unsubscribe = snack.addStateListener((state) => {
          // A package can need another that wasn't asked for, such as a peer dependency.
          const missing = Object.entries(state.missingDependencies)
          if (missing.length > 0) {
            snack.updateDependencies(Object.fromEntries(missing.map(([name, { wantedVersion }]) => [name, { version: wantedVersion ?? "*" }])))
          }
          if (state.url) setStatus(readStatus(state))
        })
        const state = await snack.getStateAsync()
        if (active) setStatus(readStatus(state))
      } catch (error) {
        if (active) setStatus({ state: "error", message: error instanceof Error ? error.message : "Couldn't start the preview." })
      }
    })()

    return () => {
      active = false
      unsubscribe?.()
      snackRef.current?.setOnline(false)
      snackRef.current = null
    }
  }, [attempt, enabled, hasProject])

  // Sends what changed: inline edits, the agent's work, and theme switches all land here.
  React.useEffect(() => {
    const snack = snackRef.current
    if (!snack || !project) return
    const removed = sentFiles.current.filter((path) => !project.files[path])
    snack.updateFiles({ ...project.files, ...Object.fromEntries(removed.map((path) => [path, null])) })
    snack.updateDependencies(project.dependencies)
    sentFiles.current = Object.keys(project.files)
  }, [project])

  return {
    status,
    hasProject,
    retry: React.useCallback(() => setAttempt((n) => n + 1), []),
  }
}
