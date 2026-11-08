// Messages between the workspace and the sandboxed frame that runs a generated
// app. The frame has an opaque origin, so all of its contact with the workspace,
// including its storage, goes through these.

import type { ScreenStatus, ScreenTab } from "@/lib/agent-protocol"
import type { AppTheme } from "@/lib/themes"

export type PreviewFile = { path: string; code: string }

export type PreviewScreen = {
  route: string
  name: string
  status: ScreenStatus
  filePath: string
  tab: ScreenTab | null
}

export type PreviewProject = {
  files: PreviewFile[]
  screens: PreviewScreen[]
}

/** The screen size generated apps are designed for, in points. */
export const DEVICE_WIDTH = 390

export const PREVIEW_FRAME_URL = "/preview-runtime/frame.html"

export type PreviewStorage = Record<string, string>

/** What the person would call each element the runtime draws. */
export const ELEMENT_LABELS: Record<string, string> = {
  View: "Container",
  SafeAreaView: "Screen",
  LinearGradient: "Gradient",
  Text: "Text",
  Image: "Image",
  ImageBackground: "Image",
  Pressable: "Button",
  TouchableOpacity: "Button",
  TouchableHighlight: "Button",
  TextInput: "Input",
  Switch: "Switch",
  Ionicons: "Icon",
}

/** A style value, where a theme color is written as its CSS variable. */
export type ElementStyleValue = string | number | { width: number; height: number }

/** What the person changed about one element by hand. */
export type ElementEdit = {
  style?: Record<string, ElementStyleValue>
  /** Props besides style, such as an icon's `name` or an image's `source`. */
  props?: Record<string, unknown>
  text?: string
}

/** Shown on top of the running code, by element, so an edit needs no restart. Keys are `<file>:<line>:<type>`. */
export type ElementEdits = Record<string, ElementEdit>

/** Where an element is in the frame, in device points. */
export type ElementRect = { x: number; y: number; width: number; height: number }

/** An element picked in a frame, as it's drawn right now. */
export type InspectedElement = {
  source: string
  /** The runtime's name for what draws it, such as "Text" or "Pressable". */
  type: string
  rect: ElementRect
  /** Its computed CSS values, by CSS property name. */
  computed: Record<string, string>
  /** What it reads, for the chat attachment. */
  label: string
  /** How many places this one line of code draws, such as the rows of a list. */
  instances: number
  hasParent: boolean
}

export type HostMessage =
  | {
      type: "load"
      project: PreviewProject
      theme: AppTheme | null
      storage: PreviewStorage
      /** The route to open on. */
      route: string
      /** False on the canvas, where the frame is a live picture of one screen. */
      interactive: boolean
      /** True while the agent is working on the screens, which is the only time the frame polls the backend. */
      syncing: boolean
      edits: ElementEdits
    }
  | { type: "project"; project: PreviewProject }
  | { type: "syncing"; syncing: boolean }
  /** Only updates CSS variables: the app isn't rebuilt or even re-rendered. */
  | { type: "theme"; theme: AppTheme | null }
  /** Another frame changed the data, or it was reset. */
  | { type: "storage"; storage: PreviewStorage }
  | { type: "reload" }
  /** Only re-renders the elements whose edits changed, so the app keeps its state. */
  | { type: "edits"; edits: ElementEdits }
  /** While on, a click picks an element instead of pressing it. */
  | { type: "edit-mode"; enabled: boolean }
  | { type: "select-parent" }
  | { type: "clear-selection" }

export type FrameMessage =
  | { type: "ready" }
  /** `value` is null when the key was removed. */
  | { type: "storage-write"; key: string; value: string | null }
  | { type: "element-selected"; element: InspectedElement | null }
  /** The selected element moved, such as from scrolling. */
  | { type: "element-moved"; rect: ElementRect }
  /** The selected element was drawn differently, after an edit. */
  | { type: "element-changed"; computed: Record<string, string>; label: string; instances: number }
  | { type: "edit-escape" }
