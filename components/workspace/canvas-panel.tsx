"use client"

import * as React from "react"
import {
  CheckIcon,
  CopyIcon,
  LayoutGridIcon,
  HandIcon,
  Loader2Icon,
  MaximizeIcon,
  MinusIcon,
  MousePointer2Icon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"

import type { InlineEditor } from "@/hooks/use-inline-editor"
import { isRunnable, screenRoute, type AppPlan, type ProjectScreen, type ScreenStatus } from "@/lib/agent-protocol"
import { DEVICE_WIDTH, type PreviewProject } from "@/lib/preview-protocol"
import { activeTheme, type AppTheme } from "@/lib/themes"
import { SCREEN_GAP, SCREEN_HEIGHT, SCREEN_WIDTH, type CanvasScreen } from "@/lib/workspace-data"
import { cn } from "@/lib/utils"
import { AppFrame } from "@/components/workspace/app-frame"
import { ElementAdvancedPanel, ElementPopover } from "@/components/workspace/element-editor"
import { ThemeSwitcher } from "@/components/workspace/theme-switcher"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

type View = { x: number; y: number; zoom: number }
type CanvasItem = CanvasScreen & { status: ScreenStatus | "planned"; route: string; runnable: boolean }
type Tool = "select" | "hand"
type Drag =
  | { kind: "pan"; startX: number; startY: number; origin: View }
  | { kind: "screen"; id: string; startX: number; startY: number; originX: number; originY: number }

const MIN_ZOOM = 0.25
const MAX_ZOOM = 2
const FIT_PADDING = 64
// Space above each frame for its name label.
const LABEL_SPACE = 28
const POPOVER_WIDTH = 304
const POPOVER_HEIGHT = 440
const POPOVER_GAP = 14
const POPOVER_MARGIN = 12
const ADVANCED_PANEL_SPACE = 344

const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))

function fitView(screens: CanvasScreen[], width: number, height: number): View {
  if (screens.length === 0 || width === 0) return { x: 0, y: 0, zoom: 1 }
  const minX = Math.min(...screens.map((s) => s.x))
  const minY = Math.min(...screens.map((s) => s.y)) - LABEL_SPACE
  const maxX = Math.max(...screens.map((s) => s.x + SCREEN_WIDTH))
  const maxY = Math.max(...screens.map((s) => s.y + SCREEN_HEIGHT))
  const zoom = clampZoom(
    Math.min(
      (width - FIT_PADDING * 2) / (maxX - minX),
      (height - FIT_PADDING * 2) / (maxY - minY),
      1
    )
  )
  return {
    zoom,
    x: (width - (maxX - minX) * zoom) / 2 - minX * zoom,
    y: (height - (maxY - minY) * zoom) / 2 - minY * zoom,
  }
}

/** Built screens when they match the plan; otherwise the plan's screens, not built yet. */
function canvasItems(plan: AppPlan | null, built: ProjectScreen[]): Omit<CanvasItem, "x" | "y">[] {
  const builtMatchesPlan =
    built.length > 0 &&
    (!plan || (built.length === plan.screens.length && built.every((s, i) => s.slug === plan.screens[i].id)))
  if (builtMatchesPlan) {
    return built.map((s) => ({
      id: s.slug,
      name: s.name,
      layout: s.layout,
      status: s.status,
      route: screenRoute(s.slug, s.position),
      runnable: isRunnable(s),
    }))
  }
  return (plan?.screens ?? []).map((s, i) => ({
    id: s.id,
    name: s.name,
    layout: s.layout,
    status: "planned",
    route: screenRoute(s.id, i),
    runnable: false,
  }))
}

export function CanvasPanel({
  projectId,
  plan,
  screens: builtScreens,
  app,
  activity,
  syncing,
  onThemeChange,
  editor,
}: {
  projectId: string
  plan: AppPlan | null
  screens: ProjectScreen[]
  /** The app as built so far, which the finished screens run from. */
  app: PreviewProject
  /** The agent's current activity, shown while there's nothing to draw yet. */
  activity: string | null
  /** True while the agent is working on the screens. */
  syncing: boolean
  onThemeChange: (themeId: string) => void
  editor: InlineEditor
}) {
  const sectionRef = React.useRef<HTMLElement>(null)
  const viewportRef = React.useRef<HTMLDivElement>(null)
  const editingFrameRef = React.useRef<HTMLDivElement>(null)
  // Where the person dragged screens to; the rest sit in a row in plan order.
  const [moved, setMoved] = React.useState<Record<string, { x: number; y: number }>>({})
  const screens: CanvasItem[] = canvasItems(plan, builtScreens).map((item, i) => ({
    ...item,
    ...(moved[item.id] ?? { x: i * (SCREEN_WIDTH + SCREEN_GAP), y: 0 }),
  }))
  const layoutKey = screens.map((s) => s.id).join("|")
  const [view, setView] = React.useState<View>({ x: 0, y: 0, zoom: 1 })
  const [tool, setTool] = React.useState<Tool>("select")
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [drag, setDrag] = React.useState<Drag | null>(null)

  const fitToScreen = React.useCallback(() => {
    const el = viewportRef.current
    if (el) setView(fitView(screens, el.clientWidth, el.clientHeight))
  }, [screens])

  // Fit once the viewport has a size, and again whenever the set of screens changes.
  const fittedKey = React.useRef<string | null>(null)
  React.useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const fitIfNeeded = () => {
      if (fittedKey.current === layoutKey || el.clientWidth === 0) return
      fittedKey.current = layoutKey
      fitToScreen()
    }
    fitIfNeeded()
    const observer = new ResizeObserver(fitIfNeeded)
    observer.observe(el)
    return () => observer.disconnect()
  }, [fitToScreen, layoutKey])

  /** Zooms around a point in viewport coordinates, keeping that point still. */
  const zoomAt = React.useCallback((nextZoom: number, cx: number, cy: number) => {
    setView((v) => {
      const zoom = clampZoom(nextZoom)
      return {
        zoom,
        x: cx - ((cx - v.x) / v.zoom) * zoom,
        y: cy - ((cy - v.y) / v.zoom) * zoom,
      }
    })
  }, [])

  function zoomFromCenter(factor: number) {
    const el = viewportRef.current
    if (el) zoomAt(view.zoom * factor, el.clientWidth / 2, el.clientHeight / 2)
  }

  // Wheel scrolls the canvas; Ctrl/⌘ + wheel (and trackpad pinch) zooms.
  // Attached natively because React's wheel listener is passive.
  React.useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    function onWheel(event: WheelEvent) {
      event.preventDefault()
      if (event.ctrlKey || event.metaKey) {
        const rect = el!.getBoundingClientRect()
        setView((v) => {
          const zoom = clampZoom(v.zoom * Math.exp(-event.deltaY * 0.01))
          const cx = event.clientX - rect.left
          const cy = event.clientY - rect.top
          return { zoom, x: cx - ((cx - v.x) / v.zoom) * zoom, y: cy - ((cy - v.y) / v.zoom) * zoom }
        })
      } else {
        setView((v) => ({ ...v, x: v.x - event.deltaX, y: v.y - event.deltaY }))
      }
    }
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [])

  /** Brings a screen to a size where its elements are easy to click. */
  function focusScreen(screen: CanvasItem) {
    const el = viewportRef.current
    if (!el) return
    const zoom = clampZoom(Math.min((el.clientHeight - FIT_PADDING * 2) / SCREEN_HEIGHT, 1.25))
    setView({
      zoom,
      x: el.clientWidth / 2 - (screen.x + SCREEN_WIDTH / 2) * zoom,
      y: el.clientHeight / 2 - (screen.y + SCREEN_HEIGHT / 2 - LABEL_SPACE / 2) * zoom,
    })
  }

  function toggleEditing(screen: CanvasItem) {
    if (editor.editingScreenId === screen.id) return editor.exit()
    setSelectedId(screen.id)
    editor.enter(screen.id)
    focusScreen(screen)
  }

  function startPan(event: React.PointerEvent) {
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrag({ kind: "pan", startX: event.clientX, startY: event.clientY, origin: view })
  }

  function handleViewportPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.button !== 1) return
    // Clicking empty canvas clears the selection.
    if (tool === "select" && event.button === 0) {
      setSelectedId(null)
      if (editor.selection) editor.clearSelection()
    }
    startPan(event)
  }

  function handleScreenPointerDown(event: React.PointerEvent<HTMLDivElement>, screen: CanvasItem) {
    if (tool === "hand" || event.button !== 0) return
    event.stopPropagation()
    setSelectedId(screen.id)
    viewportRef.current?.setPointerCapture(event.pointerId)
    setDrag({
      kind: "screen",
      id: screen.id,
      startX: event.clientX,
      startY: event.clientY,
      originX: screen.x,
      originY: screen.y,
    })
  }

  function handlePointerMove(event: React.PointerEvent) {
    if (!drag) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (drag.kind === "pan") {
      setView({ ...drag.origin, x: drag.origin.x + dx, y: drag.origin.y + dy })
    } else {
      setMoved((prev) => ({
        ...prev,
        [drag.id]: { x: drag.originX + dx / view.zoom, y: drag.originY + dy / view.zoom },
      }))
    }
  }

  const endDrag = () => setDrag(null)
  const selected = screens.find((s) => s.id === selectedId)
  const theme = activeTheme(plan?.themePackage)
  const editingScreen = screens.find((s) => s.id === editor.editingScreenId)

  // A screen that's no longer on the canvas, or can no longer run, can't stay in edit mode.
  const { editingScreenId, exit: exitEditing, selection } = editor
  React.useEffect(() => {
    if (editingScreenId && !editingScreen?.runnable) exitEditing()
  }, [editingScreen?.runnable, editingScreenId, exitEditing])

  // Escape closes what's open first, then leaves edit mode.
  const handleEscape = React.useCallback(() => {
    if (selection) editor.clearSelection()
    else exitEditing()
  }, [editor, exitEditing, selection])
  React.useEffect(() => {
    if (!editingScreenId) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented) handleEscape()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [editingScreenId, handleEscape])

  // The advanced panel sits on the right of the canvas, so the screen moves out from under it.
  const advancedOpen = Boolean(editor.advanced && selection)
  React.useLayoutEffect(() => {
    const section = sectionRef.current
    const frame = editingFrameRef.current
    if (!advancedOpen || !section || !frame) return
    const overlap = frame.getBoundingClientRect().right + POPOVER_GAP - (section.getBoundingClientRect().right - ADVANCED_PANEL_SPACE)
    if (overlap > 0) setView((v) => ({ ...v, x: v.x - overlap }))
    // Only when it opens: after that, the screen stays wherever the person pans it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advancedOpen])

  // Where the quick editor goes: beside the element, or wherever it fits. Follows panning and zooming.
  const [popoverPosition, setPopoverPosition] = React.useState<{ left: number; top: number; maxHeight: number } | null>(null)
  const elementRect = selection?.rect
  React.useLayoutEffect(() => {
    const section = sectionRef.current
    const frame = editingFrameRef.current
    if (!section || !frame || !elementRect) return setPopoverPosition(null)
    const bounds = section.getBoundingClientRect()
    const box = frame.getBoundingClientRect()
    const scale = box.width / DEVICE_WIDTH
    const left = box.left - bounds.left + elementRect.x * scale
    const top = box.top - bounds.top + elementRect.y * scale
    const right = left + elementRect.width * scale
    const maxHeight = Math.min(POPOVER_HEIGHT, bounds.height - POPOVER_MARGIN * 2)
    const fitsRight = right + POPOVER_GAP + POPOVER_WIDTH <= bounds.width - POPOVER_MARGIN
    const fitsLeft = left - POPOVER_GAP - POPOVER_WIDTH >= POPOVER_MARGIN
    const x = fitsRight ? right + POPOVER_GAP : fitsLeft ? left - POPOVER_GAP - POPOVER_WIDTH : bounds.width - POPOVER_WIDTH - POPOVER_MARGIN
    const clampedX = Math.max(POPOVER_MARGIN, Math.min(x, bounds.width - POPOVER_WIDTH - POPOVER_MARGIN))
    const clampedY = Math.max(POPOVER_MARGIN, Math.min(top - 8, bounds.height - maxHeight - POPOVER_MARGIN))
    setPopoverPosition((current) =>
      current && current.left === clampedX && current.top === clampedY && current.maxHeight === maxHeight
        ? current
        : { left: clampedX, top: clampedY, maxHeight }
    )
  }, [elementRect, view, moved, editor.advanced])

  return (
    <section ref={sectionRef} aria-label="Canvas" className="relative flex h-full min-h-0 flex-col bg-neutral-50">
      <div
        ref={viewportRef}
        role="application"
        aria-roledescription="canvas"
        aria-label="App screens canvas. Drag to pan, Ctrl or Command and scroll to zoom."
        onPointerDown={handleViewportPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={cn(
          "relative min-h-0 flex-1 touch-none overflow-hidden select-none",
          drag?.kind === "pan" ? "cursor-grabbing" : tool === "hand" ? "cursor-grab" : "cursor-default"
        )}
        style={{
          backgroundImage: "radial-gradient(rgba(76,29,149,0.14) 1px, transparent 1px)",
          backgroundSize: `${22 * view.zoom}px ${22 * view.zoom}px`,
          backgroundPosition: `${view.x}px ${view.y}px`,
        }}
      >
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
        >
          {screens.map((screen) => (
            <ScreenFrame
              key={screen.id}
              screen={screen}
              projectId={projectId}
              app={app}
              theme={theme}
              syncing={syncing}
              selected={screen.id === selectedId}
              dragging={drag?.kind === "screen" && drag.id === screen.id}
              interactive={tool === "select"}
              onPointerDown={(e) => handleScreenPointerDown(e, screen)}
              editor={editor}
              editing={screen.id === editor.editingScreenId}
              dimmed={Boolean(editor.editingScreenId) && screen.id !== editor.editingScreenId}
              frameRef={screen.id === editor.editingScreenId ? editingFrameRef : undefined}
              onToggleEditing={() => toggleEditing(screen)}
              onEditEscape={handleEscape}
            />
          ))}
        </div>

        {screens.length === 0 && <CanvasEmptyState activity={activity} />}

        {selected && !drag && !editingScreen && (
          <SelectionToolbar
            canEdit={selected.runnable && !editor.locked}
            onEdit={() => toggleEditing(selected)}
            style={{
              left: view.x + (selected.x + SCREEN_WIDTH / 2) * view.zoom,
              top: view.y + (selected.y - LABEL_SPACE) * view.zoom - 8,
            }}
          />
        )}
      </div>

      {editingScreen && <EditModeBar editor={editor} screenName={editingScreen.name} besidePanel={advancedOpen} />}

      {editingScreen && selection && !editor.advanced && popoverPosition && (
        <ElementPopover
          editor={editor}
          theme={theme}
          screenName={editingScreen.name}
          style={{ left: popoverPosition.left, top: popoverPosition.top, maxHeight: popoverPosition.maxHeight }}
        />
      )}
      {editingScreen && selection && editor.advanced && (
        <ElementAdvancedPanel editor={editor} theme={theme} screenName={editingScreen.name} />
      )}

      {plan?.themePackage && !editor.readOnly && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-9 *:pointer-events-auto">
          <ThemeSwitcher themePackage={plan.themePackage} onChange={onThemeChange} />
        </div>
      )}

      <div
        role="toolbar"
        aria-label="Canvas tools"
        className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-white/70 bg-white/90 p-1 shadow-[0_8px_32px_-12px_rgba(76,29,149,0.35)] ring-1 ring-black/[0.03] backdrop-blur-xl"
      >
        <ToolButton label="Select (move screens)" active={tool === "select"} onClick={() => setTool("select")}>
          <MousePointer2Icon />
        </ToolButton>
        <ToolButton label="Hand (pan canvas)" active={tool === "hand"} onClick={() => setTool("hand")}>
          <HandIcon />
        </ToolButton>
        <span aria-hidden className="mx-1 h-5 w-px bg-border" />
        <ToolButton label="Zoom out" onClick={() => zoomFromCenter(1 / 1.2)} disabled={view.zoom <= MIN_ZOOM}>
          <MinusIcon />
        </ToolButton>
        <span className="w-12 text-center text-xs font-medium tabular-nums text-muted-foreground" aria-live="polite">
          {Math.round(view.zoom * 100)}%
        </span>
        <ToolButton label="Zoom in" onClick={() => zoomFromCenter(1.2)} disabled={view.zoom >= MAX_ZOOM}>
          <PlusIcon />
        </ToolButton>
        <ToolButton label="Fit to screen" onClick={fitToScreen}>
          <MaximizeIcon />
        </ToolButton>
      </div>
    </section>
  )
}

function ToolButton({
  label,
  active,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { label: string; active?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            aria-pressed={active}
            className={cn(
              "rounded-full text-muted-foreground hover:bg-violet-500/10 hover:text-violet-700",
              active && "bg-violet-500/10 text-violet-700"
            )}
            {...props}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function EditModeBar({ editor, screenName, besidePanel }: { editor: InlineEditor; screenName: string; besidePanel: boolean }) {
  return (
    <div
      role="status"
      style={besidePanel ? { left: `calc((100% - ${ADVANCED_PANEL_SPACE}px) / 2)`, maxWidth: `calc(100% - ${ADVANCED_PANEL_SPACE + 12}px)` } : undefined}
      className="absolute top-11 left-1/2 z-10 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-white/70 bg-white/95 py-1 pr-1 pl-3 text-xs shadow-lg shadow-violet-500/15 ring-1 ring-black/[0.04] backdrop-blur"
    >
      <span className="flex items-center gap-1.5 truncate font-medium text-violet-700">
        <PencilIcon className="size-3.5 shrink-0" />
        <span className="truncate">Editing {screenName}</span>
      </span>
      <span className="hidden truncate text-muted-foreground sm:inline">
        {editor.saveError ? (
          <span className="text-red-700">Not saved</span>
        ) : editor.saving ? (
          <span className="inline-flex items-center gap-1">
            <Loader2Icon className="size-3 animate-spin" />
            Saving
          </span>
        ) : editor.selection ? (
          "Changes save as you go"
        ) : (
          "Click any element to edit it"
        )}
      </span>
      <Button
        type="button"
        size="sm"
        onClick={editor.exit}
        className="h-6 shrink-0 rounded-full bg-violet-600 px-2.5 text-[11px] text-white hover:bg-violet-700"
      >
        Done
      </Button>
    </div>
  )
}

function SelectionToolbar({ style, canEdit, onEdit }: { style: React.CSSProperties; canEdit: boolean; onEdit: () => void }) {
  const actions = [
    { label: "Edit screen", icon: PencilIcon, disabled: !canEdit, onClick: onEdit },
    { label: "Duplicate", icon: CopyIcon },
    { label: "Delete", icon: Trash2Icon },
  ]
  return (
    <div
      role="toolbar"
      aria-label="Screen actions"
      onPointerDown={(e) => e.stopPropagation()}
      style={style}
      className="absolute z-10 flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-full border border-white/70 bg-white p-1 shadow-lg shadow-violet-500/15 ring-1 ring-black/[0.04]"
    >
      {actions.map(({ label, icon: Icon, disabled, onClick }) => (
        <ToolButton key={label} label={label} size="icon-sm" disabled={disabled} onClick={onClick}>
          <Icon />
        </ToolButton>
      ))}
    </div>
  )
}

function CanvasEmptyState({ activity }: { activity: string | null }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
      <div className="max-w-xs rounded-3xl border border-white/70 bg-white/80 p-6 text-center shadow-[0_12px_40px_-20px_rgba(76,29,149,0.35)] backdrop-blur">
        <span className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-linear-to-br from-indigo-100 to-fuchsia-100 text-violet-600">
          {activity ? <Spinner className="size-5" aria-hidden /> : <LayoutGridIcon className="size-5" />}
        </span>
        <p className="mt-3 text-sm font-medium">
          {activity ? "The agent is planning your app" : "Your screens will appear here"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground" role={activity ? "status" : undefined}>
          {activity ?? "Once the agent plans your app, each screen shows up on this canvas."}
        </p>
      </div>
    </div>
  )
}

function ScreenStatusChip({ status }: { status: CanvasItem["status"] }) {
  if (status === "generating") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-700">
        <Spinner className="size-3" aria-hidden />
        Building
      </span>
    )
  }
  if (status === "done") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
        <CheckIcon className="size-3" />
        Built
      </span>
    )
  }
  if (status === "failed") {
    return <span className="shrink-0 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-700">Failed</span>
  }
  return (
    <span className="shrink-0 rounded-full bg-neutral-200/70 px-2 py-0.5 text-[11px] text-muted-foreground">
      {status === "planned" ? "Planned" : "Queued"}
    </span>
  )
}

function ScreenFrame({
  screen,
  projectId,
  app,
  theme,
  syncing,
  selected,
  dragging,
  interactive,
  onPointerDown,
  editor,
  editing,
  dimmed,
  frameRef,
  onToggleEditing,
  onEditEscape,
}: {
  screen: CanvasItem
  projectId: string
  app: PreviewProject
  theme: AppTheme | null
  syncing: boolean
  selected: boolean
  dragging: boolean
  interactive: boolean
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
  editor: InlineEditor
  editing: boolean
  dimmed: boolean
  /** Set on the screen being edited, to place the editor next to its elements. */
  frameRef?: React.Ref<HTMLDivElement>
  onToggleEditing: () => void
  onEditEscape: () => void
}) {
  return (
    <div
      className={cn("absolute transition-opacity", dimmed && "opacity-40")}
      style={{ left: screen.x, top: screen.y - LABEL_SPACE, width: SCREEN_WIDTH }}
    >
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <p className={cn("truncate text-sm font-medium", selected ? "text-violet-700" : "text-muted-foreground")}>
          {screen.name}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <ScreenStatusChip status={screen.status} />
          {screen.runnable && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={editing ? `Stop editing ${screen.name}` : `Edit ${screen.name}`}
                    aria-pressed={editing}
                    disabled={editor.locked}
                    // On the canvas, a press would start panning and take the click with it.
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={onToggleEditing}
                    className={cn(
                      "flex size-5.5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-violet-500/10 hover:text-violet-700 disabled:pointer-events-none disabled:opacity-40",
                      editing && "bg-violet-600 text-white hover:bg-violet-700 hover:text-white"
                    )}
                  />
                }
              >
                <PencilIcon className="size-3" />
              </TooltipTrigger>
              <TooltipContent>{editor.readOnly ? "You have view-only access" : editor.locked ? "Wait for the agent to finish" : editing ? "Stop editing" : "Edit this screen"}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
      <div
        onPointerDown={onPointerDown}
        className={cn(
          "overflow-hidden rounded-[2rem] border-[6px] border-neutral-900 bg-white shadow-[0_24px_48px_-24px_rgba(76,29,149,0.35)] transition-shadow",
          interactive && !editing && (dragging ? "cursor-grabbing" : "cursor-grab"),
          selected && "ring-2 ring-violet-500 ring-offset-4 ring-offset-neutral-50",
          dragging && "shadow-[0_32px_64px_-24px_rgba(76,29,149,0.5)]"
        )}
        style={{ height: SCREEN_HEIGHT }}
      >
        <div
          ref={frameRef}
          className={cn(
            "relative h-full transition-opacity",
            (screen.status === "planned" || screen.status === "pending") && "opacity-60",
            screen.status === "generating" && "animate-pulse"
          )}
        >
          {screen.runnable ? (
            <AppFrame
              // A frame opens on its route once, so a screen whose route changed needs a new one.
              key={screen.route}
              projectId={projectId}
              project={app}
              theme={theme}
              route={screen.route}
              interactive={false}
              title={screen.name}
              syncing={syncing}
              edits={editor.edits}
              editMode={editing}
              selectParentSignal={editing ? editor.selectParentSignal : undefined}
              clearSelectionSignal={editing ? editor.clearSelectionSignal : undefined}
              onElementSelected={editing ? editor.handleSelected : undefined}
              onElementMoved={editing ? editor.handleMoved : undefined}
              onElementChanged={editing ? editor.handleChanged : undefined}
              onEditEscape={editing ? onEditEscape : undefined}
            />
          ) : (
            <ScreenWireframe layout={screen.layout} />
          )}
        </div>
      </div>
    </div>
  )
}

/** Placeholder content until the agent generates real screens. */
function ScreenWireframe({ layout }: { layout: CanvasScreen["layout"] }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-5 pt-3 pb-2 text-[10px] font-semibold text-neutral-800">
        <span>9:41</span>
        <span className="h-4 w-16 rounded-full bg-neutral-900" />
        <span className="flex gap-0.5">
          <span className="size-1.5 rounded-full bg-neutral-800" />
          <span className="size-1.5 rounded-full bg-neutral-800" />
          <span className="h-1.5 w-3 rounded-sm bg-neutral-800" />
        </span>
      </div>

      <div className="flex-1 space-y-3 overflow-hidden px-4 pt-2">
        {layout === "home" && (
          <>
            <div className="h-3 w-24 rounded-full bg-neutral-200" />
            <div className="h-2 w-36 rounded-full bg-neutral-100" />
            <div className="h-28 rounded-2xl bg-linear-to-br from-indigo-400 via-violet-400 to-fuchsia-400" />
            <div className="grid grid-cols-2 gap-2">
              <div className="h-20 rounded-xl bg-violet-50" />
              <div className="h-20 rounded-xl bg-fuchsia-50" />
            </div>
            {[0, 1].map((i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="size-9 rounded-xl bg-neutral-100" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-2 w-3/4 rounded-full bg-neutral-200" />
                  <div className="h-2 w-1/2 rounded-full bg-neutral-100" />
                </div>
              </div>
            ))}
          </>
        )}
        {layout === "list" && (
          <>
            <div className="h-8 rounded-full bg-neutral-100" />
            <div className="flex gap-1.5">
              {["w-12", "w-16", "w-10"].map((w, i) => (
                <div key={i} className={cn("h-5 rounded-full", w, i === 0 ? "bg-violet-500" : "bg-neutral-100")} />
              ))}
            </div>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-2.5 rounded-xl border border-neutral-100 p-2">
                <div className="size-12 rounded-lg bg-linear-to-br from-violet-100 to-fuchsia-100" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-2 w-3/4 rounded-full bg-neutral-200" />
                  <div className="h-2 w-1/2 rounded-full bg-neutral-100" />
                </div>
              </div>
            ))}
          </>
        )}
        {layout === "detail" && (
          <>
            <div className="-mx-4 h-40 bg-linear-to-br from-indigo-200 to-fuchsia-200" />
            <div className="h-3 w-32 rounded-full bg-neutral-200" />
            <div className="space-y-1.5">
              <div className="h-2 w-full rounded-full bg-neutral-100" />
              <div className="h-2 w-full rounded-full bg-neutral-100" />
              <div className="h-2 w-2/3 rounded-full bg-neutral-100" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 rounded-xl bg-neutral-50" />
              ))}
            </div>
            <div className="h-10 rounded-full bg-violet-500" />
          </>
        )}
        {layout === "profile" && (
          <>
            <div className="flex flex-col items-center gap-2 pt-2">
              <div className="size-16 rounded-full bg-linear-to-br from-indigo-300 to-fuchsia-300" />
              <div className="h-3 w-24 rounded-full bg-neutral-200" />
              <div className="h-2 w-16 rounded-full bg-neutral-100" />
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-10 rounded-xl bg-violet-50" />
              ))}
            </div>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center justify-between border-b border-neutral-100 py-2">
                <div className="h-2 w-24 rounded-full bg-neutral-200" />
                <div className="h-2 w-2 rounded-full bg-neutral-300" />
              </div>
            ))}
          </>
        )}
      </div>

      <div className="flex justify-around border-t border-neutral-100 px-4 py-3">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cn("size-4 rounded-md", i === 0 ? "bg-violet-500" : "bg-neutral-200")} />
        ))}
      </div>
    </div>
  )
}
