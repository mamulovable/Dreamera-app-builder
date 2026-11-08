// Edit mode: picks elements under the pointer, and shows the person's edits on top
// of the running code. Edits never restart the app, so it keeps its state.

import { ELEMENT_LABELS, type ElementEdit, type ElementEdits, type ElementRect, type InspectedElement } from "@/lib/preview-protocol"

import { postToHost } from "./host"

// ---------- Edits ----------

let edits: ElementEdits = {}
const editListeners = new Set<() => void>()

export function setElementEdits(next: ElementEdits) {
  edits = next
  editListeners.forEach((listener) => listener())
  // After React has drawn the edit.
  requestAnimationFrame(() => {
    if (!selected?.isConnected) return
    const { computed, label, instances } = inspect(selected)
    postToHost({ type: "element-changed", computed, label, instances })
  })
}

export function subscribeElementEdits(listener: () => void) {
  editListeners.add(listener)
  return () => {
    editListeners.delete(listener)
  }
}

export function elementEdit(source: string): ElementEdit | undefined {
  return edits[source]
}

// ---------- Picking ----------

const SOURCE_SELECTOR = "[data-af-source]"

/** Read when an element is picked. The workspace shows them as the current values. */
const COMPUTED_PROPERTIES = [
  "color",
  "background-color",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-transform",
  "text-decoration-line",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "row-gap",
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
  "flex-direction",
  "flex-wrap",
  "flex-grow",
  "justify-content",
  "align-items",
  "align-self",
  "position",
  "overflow",
  "border-top-width",
  "border-top-color",
  "border-top-left-radius",
  "opacity",
  "box-shadow",
]

// The app must not react to anything while its elements are being picked.
const BLOCKED_EVENTS = [
  "pointerdown",
  "pointerup",
  "mousedown",
  "mouseup",
  "touchstart",
  "touchend",
  "dblclick",
  "contextmenu",
  "keyup",
  "keypress",
]

let enabled = false
let selected: HTMLElement | null = null
let selectedSource: string | null = null
let lastRect: ElementRect | null = null
let tracking = 0
let hoverBox: HTMLElement | null = null
let selectionBox: HTMLElement | null = null

function makeBox(selection: boolean) {
  const box = document.createElement("div")
  const tag = document.createElement("span")
  box.style.cssText = `position:fixed;z-index:2147483647;pointer-events:none;box-sizing:border-box;display:none;border-radius:3px;${
    selection ? "border:2px solid #7c3aed;background:rgba(124,58,237,.08)" : "border:2px dashed rgba(124,58,237,.7)"
  }`
  tag.style.cssText =
    "position:absolute;left:-2px;bottom:100%;margin-bottom:3px;padding:2px 7px;border-radius:6px;background:#7c3aed;color:#fff;font:600 13px/18px -apple-system,BlinkMacSystemFont,sans-serif;white-space:nowrap"
  box.append(tag)
  document.body.append(box)
  return box
}

function placeBox(box: HTMLElement | null, element: HTMLElement | null) {
  if (!box) return
  if (!element) {
    box.style.display = "none"
    return
  }
  const rect = element.getBoundingClientRect()
  box.style.display = "block"
  box.style.left = `${rect.left}px`
  box.style.top = `${rect.top}px`
  box.style.width = `${rect.width}px`
  box.style.height = `${rect.height}px`
  const tag = box.firstElementChild as HTMLElement
  const type = element.dataset.afType ?? ""
  tag.textContent = ELEMENT_LABELS[type] ?? type
  // An element at the very top keeps its tag inside the frame.
  tag.style.bottom = rect.top < 26 ? "auto" : "100%"
  tag.style.top = rect.top < 26 ? "3px" : "auto"
  tag.style.marginLeft = rect.top < 26 ? "5px" : "0"
}

function toRect(element: HTMLElement): ElementRect {
  const { x, y, width, height } = element.getBoundingClientRect()
  return { x, y, width, height }
}

function pickable(target: EventTarget | null) {
  return target instanceof Element ? target.closest<HTMLElement>(SOURCE_SELECTOR) : null
}

function matchingElements(source: string) {
  return document.querySelectorAll<HTMLElement>(`[data-af-source="${CSS.escape(source)}"]`)
}

function inspect(element: HTMLElement): InspectedElement {
  const source = element.dataset.afSource!
  // An icon's color is on the svg inside it.
  const style = getComputedStyle(element)
  const svg = element.querySelector("svg")
  const computed = Object.fromEntries(COMPUTED_PROPERTIES.map((name) => [name, style.getPropertyValue(name)]))
  if (svg) computed.color = getComputedStyle(svg).color
  return {
    source,
    type: element.dataset.afType ?? "View",
    rect: toRect(element),
    computed,
    label: (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60),
    instances: matchingElements(source).length,
    hasParent: Boolean(element.parentElement?.closest(SOURCE_SELECTOR)),
  }
}

function select(element: HTMLElement | null) {
  selected = element
  selectedSource = element?.dataset.afSource ?? null
  lastRect = element && toRect(element)
  placeBox(selectionBox, element)
  placeBox(hoverBox, null)
  postToHost({ type: "element-selected", element: element && inspect(element) })
  cancelAnimationFrame(tracking)
  if (element) tracking = requestAnimationFrame(track)
}

/** Keeps the outline on the element as it scrolls, resizes, or is drawn again. */
function track() {
  if (!selected) return
  if (!selected.isConnected) {
    const again = selectedSource ? matchingElements(selectedSource)[0] : undefined
    if (!again) return select(null)
    selected = again
  }
  const rect = toRect(selected)
  if (!lastRect || rect.x !== lastRect.x || rect.y !== lastRect.y || rect.width !== lastRect.width || rect.height !== lastRect.height) {
    lastRect = rect
    placeBox(selectionBox, selected)
    postToHost({ type: "element-moved", rect })
  }
  tracking = requestAnimationFrame(track)
}

function swallow(event: Event) {
  event.preventDefault()
  event.stopImmediatePropagation()
}

function onPointerMove(event: PointerEvent) {
  const element = pickable(event.target)
  placeBox(hoverBox, element === selected ? null : element)
}

function onClick(event: MouseEvent) {
  swallow(event)
  select(pickable(event.target))
}

function onKeyDown(event: KeyboardEvent) {
  swallow(event)
  if (event.key === "Escape") postToHost({ type: "edit-escape" })
}

// Scrolling stays on, to reach what's further down. Pinching would zoom the whole workspace from in here.
function onWheel(event: WheelEvent) {
  if (event.ctrlKey || event.metaKey) event.preventDefault()
}

export function setEditMode(next: boolean) {
  if (enabled === next) return
  enabled = next
  const method = next ? "addEventListener" : "removeEventListener"
  // On the window while capturing, so these come before react-native-web's own listeners.
  for (const type of BLOCKED_EVENTS) window[method](type, swallow, true)
  window[method]("click", onClick as EventListener, true)
  window[method]("keydown", onKeyDown as EventListener, true)
  window[method]("pointermove", onPointerMove as EventListener, true)
  if (next) {
    window.addEventListener("wheel", onWheel, { capture: true, passive: false })
    hoverBox ??= makeBox(false)
    selectionBox ??= makeBox(true)
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    document.documentElement.style.cursor = "crosshair"
  } else {
    window.removeEventListener("wheel", onWheel, { capture: true })
    document.documentElement.style.cursor = ""
    placeBox(hoverBox, null)
    clearSelection()
  }
}

export function selectParent() {
  const parent = selected?.parentElement?.closest<HTMLElement>(SOURCE_SELECTOR)
  if (parent) select(parent)
}

export function clearSelection() {
  if (selected || selectedSource) select(null)
}
