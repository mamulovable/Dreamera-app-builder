"use client"

import * as React from "react"

import { isWebPublishActive, type WebPublishSummary } from "@/lib/publish-protocol"

const POLL_MS = 5000

/**
 * The project's website, for the Publish dialog and the App Preview. It lives above both, so a publish
 * is followed with the dialog closed. The server holds the status, so a reload picks it back up.
 */
export function useWebPublish(projectId: string, enabled: boolean, beforePublish: () => Promise<boolean>) {
  const [web, setWeb] = React.useState<WebPublishSummary | null>(null)
  const [starting, setStarting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const refresh = React.useCallback(async () => {
    const response = await fetch(`/api/projects/${projectId}/publish/web`).catch(() => null)
    const body = await response?.json().catch(() => null)
    if (response?.ok) setWeb(body.web)
  }, [projectId])

  React.useEffect(() => {
    if (enabled) void refresh()
  }, [enabled, refresh])

  const following = enabled && !starting && web !== null && isWebPublishActive(web.status)
  React.useEffect(() => {
    if (!following) return
    const timer = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(timer)
  }, [following, refresh])

  /** Answers with the server's code, if what publishing needs has changed under the caller. */
  const publish = React.useCallback(async (): Promise<string | undefined> => {
    setStarting(true)
    setError(null)
    try {
      if (!(await beforePublish())) {
        setError("We couldn't save your latest edits, so we didn't publish. Please try again.")
        return
      }
      const response = await fetch(`/api/projects/${projectId}/publish/web`, { method: "POST" }).catch(() => null)
      const body = await response?.json().catch(() => null)
      if (!response?.ok) {
        setError(body?.error ?? "Couldn't reach the server. Check your connection and try again.")
        // A publish already running is one this tab should be following.
        void refresh()
        return body?.code
      }
      setWeb(body.web)
    } finally {
      setStarting(false)
    }
  }, [beforePublish, projectId, refresh])

  return { web, starting, error, publish, active: starting || (web !== null && isWebPublishActive(web.status)) }
}

export type WebPublishState = ReturnType<typeof useWebPublish>
