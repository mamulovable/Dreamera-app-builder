"use client"

import * as React from "react"

import type { PreviewProject } from "@/lib/preview-protocol"
import type { AppTheme } from "@/lib/themes"

export type ProjectPreview = { project: PreviewProject; theme: AppTheme | null }

/**
 * Where previews on the home page keep the data the person makes while trying an
 * app. It's apart from the workspace's, since these run on sample data.
 */
export function demoStorageId(projectId: string) {
  return `demo:${projectId}`
}

/** Loads the app's latest screens once `enabled` turns on, and keeps them from then on. */
export function useProjectPreview(projectId: string, enabled: boolean) {
  const [preview, setPreview] = React.useState<ProjectPreview | null>(null)
  const [failed, setFailed] = React.useState(false)
  const [attempt, setAttempt] = React.useState(0)

  React.useEffect(() => {
    if (!enabled || preview) return
    const controller = new AbortController()
    setFailed(false)
    fetch(`/api/projects/${projectId}/preview`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`The preview answered ${response.status}.`)
        return response.json() as Promise<ProjectPreview>
      })
      .then(setPreview)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    return () => controller.abort()
  }, [attempt, enabled, preview, projectId])

  const retry = React.useCallback(() => setAttempt((n) => n + 1), [])

  return { preview, failed, retry }
}
