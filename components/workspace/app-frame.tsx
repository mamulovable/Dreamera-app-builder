"use client"

import * as React from "react"

import {
  DEVICE_WIDTH,
  PREVIEW_FRAME_URL,
  type ElementEdits,
  type ElementRect,
  type FrameMessage,
  type HostMessage,
  type InspectedElement,
  type PreviewProject,
} from "@/lib/preview-protocol"
import { ensurePreviewDevice, readPreviewStorage, subscribePreviewStorage, writePreviewStorage } from "@/lib/preview-storage"
import type { AppTheme } from "@/lib/themes"

/**
 * Runs the generated app in a sandboxed frame, scaled to fit its container. The
 * app's code is AI-generated, so without `allow-same-origin` it can't reach this
 * site's cookies, storage, or pages.
 */
export function AppFrame({
  projectId,
  project,
  theme,
  route,
  interactive,
  title,
  syncing,
  reloadSignal = 0,
  edits,
  editMode = false,
  selectParentSignal = 0,
  clearSelectionSignal = 0,
  onElementSelected,
  onElementMoved,
  onElementChanged,
  onEditEscape,
}: {
  projectId: string
  project: PreviewProject
  theme: AppTheme | null
  route: string
  /** False for a live picture of one screen, which can't be tapped. */
  interactive: boolean
  title: string
  /** True while the agent is working on the screens. The app only polls its backend then. */
  syncing: boolean
  /** Change this to restart the app. */
  reloadSignal?: number
  /** Edits made by hand, shown on top of the running code. */
  edits: ElementEdits
  /** While on, a click picks an element instead of pressing it. */
  editMode?: boolean
  /** Change this to select the parent of the selected element. */
  selectParentSignal?: number
  /** Change this to clear the selection. */
  clearSelectionSignal?: number
  onElementSelected?: (element: InspectedElement | null) => void
  onElementMoved?: (rect: ElementRect) => void
  onElementChanged?: (change: Pick<InspectedElement, "computed" | "label" | "instances">) => void
  onEditEscape?: () => void
}) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const frameRef = React.useRef<HTMLIFrameElement>(null)
  const [size, setSize] = React.useState<{ scale: number; height: number } | null>(null)
  const [ready, setReady] = React.useState(false)

  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const measure = () => {
      const scale = container.clientWidth / DEVICE_WIDTH
      if (scale > 0) setSize({ scale, height: container.clientHeight / scale })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const post = React.useCallback((message: HostMessage) => {
    frameRef.current?.contentWindow?.postMessage(message, "*")
  }, [])

  // The latest values, for when the frame reports it's ready.
  const latest = React.useRef({ project, theme, route, interactive, syncing, edits })
  const handlers = React.useRef({ onElementSelected, onElementMoved, onElementChanged, onEditEscape })
  React.useEffect(() => {
    latest.current = { project, theme, route, interactive, syncing, edits }
    handlers.current = { onElementSelected, onElementMoved, onElementChanged, onEditEscape }
  })

  React.useEffect(() => {
    function onMessage(event: MessageEvent<FrameMessage>) {
      if (event.source !== frameRef.current?.contentWindow) return
      const message = event.data
      if (message.type === "ready") {
        post({ type: "load", ...latest.current, storage: ensurePreviewDevice(projectId) })
        setReady(true)
      } else if (message.type === "storage-write" && typeof message.key === "string") {
        writePreviewStorage(projectId, message.key, message.value, event.source)
      } else if (message.type === "element-selected") {
        handlers.current.onElementSelected?.(message.element)
      } else if (message.type === "element-moved") {
        handlers.current.onElementMoved?.(message.rect)
      } else if (message.type === "element-changed") {
        const { computed, label, instances } = message
        handlers.current.onElementChanged?.({ computed, label, instances })
      } else if (message.type === "edit-escape") {
        handlers.current.onEditEscape?.()
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [post, projectId])

  React.useEffect(
    () =>
      subscribePreviewStorage(projectId, (storage, source) => {
        if (ready && source !== frameRef.current?.contentWindow) post({ type: "storage", storage })
      }),
    [post, projectId, ready]
  )

  // `load` already carried these values, so each effect only sends later changes.
  const sentProject = React.useRef(project)
  React.useEffect(() => {
    if (ready && sentProject.current !== project) post({ type: "project", project })
    sentProject.current = project
  }, [post, project, ready])

  const sentTheme = React.useRef(theme)
  React.useEffect(() => {
    if (ready && sentTheme.current !== theme) post({ type: "theme", theme })
    sentTheme.current = theme
  }, [post, ready, theme])

  const sentSyncing = React.useRef(syncing)
  React.useEffect(() => {
    if (ready && sentSyncing.current !== syncing) post({ type: "syncing", syncing })
    sentSyncing.current = syncing
  }, [post, ready, syncing])

  const sentReload = React.useRef(reloadSignal)
  React.useEffect(() => {
    if (ready && sentReload.current !== reloadSignal) post({ type: "reload" })
    sentReload.current = reloadSignal
  }, [post, ready, reloadSignal])

  const sentEdits = React.useRef(edits)
  React.useEffect(() => {
    if (ready && sentEdits.current !== edits) post({ type: "edits", edits })
    sentEdits.current = edits
  }, [edits, post, ready])

  React.useEffect(() => {
    if (ready) post({ type: "edit-mode", enabled: editMode })
  }, [editMode, post, ready])

  const sentSelectParent = React.useRef(selectParentSignal)
  React.useEffect(() => {
    if (ready && sentSelectParent.current !== selectParentSignal) post({ type: "select-parent" })
    sentSelectParent.current = selectParentSignal
  }, [post, ready, selectParentSignal])

  const sentClearSelection = React.useRef(clearSelectionSignal)
  React.useEffect(() => {
    if (ready && sentClearSelection.current !== clearSelectionSignal) post({ type: "clear-selection" })
    sentClearSelection.current = clearSelectionSignal
  }, [clearSelectionSignal, post, ready])

  const receivesPointer = interactive || editMode

  return (
    <div ref={containerRef} className="relative size-full overflow-hidden" style={{ background: theme?.colors.background }}>
      {size && (
        <iframe
          ref={frameRef}
          src={PREVIEW_FRAME_URL}
          title={title}
          sandbox="allow-scripts allow-popups"
          tabIndex={receivesPointer ? undefined : -1}
          aria-hidden={receivesPointer ? undefined : true}
          className="absolute top-0 left-0 origin-top-left border-0"
          style={{
            width: DEVICE_WIDTH,
            height: size.height,
            transform: `scale(${size.scale})`,
            pointerEvents: receivesPointer ? undefined : "none",
          }}
        />
      )}
    </div>
  )
}
