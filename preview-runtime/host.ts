// This frame's link to the workspace. It's sandboxed with an opaque origin, which
// has no localStorage of its own, so the workspace keeps the app's data. A copy
// here lets reads answer straight away.

import type { FrameMessage, PreviewStorage } from "@/lib/preview-protocol"
import { THEME_TOKENS, themeCssVariable, themeFromDesign, type AppTheme } from "@/lib/themes"

export function postToHost(message: FrameMessage) {
  window.parent.postMessage(message, "*")
}

let storage: PreviewStorage = {}

export function setStorageSnapshot(next: PreviewStorage) {
  storage = next
}

function write(key: string, value: string | null) {
  if (value === null) delete storage[key]
  else storage[key] = value
  postToHost({ type: "storage-write", key, value })
}

/** The AsyncStorage API, over this frame's copy of the data. */
export const AsyncStorage = {
  getItem: async (key: string) => storage[key] ?? null,
  setItem: async (key: string, value: string) => write(key, String(value)),
  removeItem: async (key: string) => write(key, null),
  mergeItem: async (key: string, value: string) =>
    write(key, JSON.stringify({ ...JSON.parse(storage[key] ?? "{}"), ...JSON.parse(value) })),
  clear: async () => Object.keys(storage).forEach((key) => write(key, null)),
  getAllKeys: async () => Object.keys(storage),
  multiGet: async (keys: string[]) => keys.map((key) => [key, storage[key] ?? null]),
  multiSet: async (pairs: [string, string][]) => pairs.forEach(([key, value]) => write(key, value)),
  multiRemove: async (keys: string[]) => keys.forEach((key) => write(key, null)),
}

// For apps built before themes existed, so the frame's own messages stay readable.
const NEUTRAL_THEME = themeFromDesign({
  mode: "light",
  primaryColor: "#6d28d9",
  accentColor: "#db2777",
  backgroundColor: "#f8f8fb",
})

/** Switches theme by only changing CSS variables, so nothing in the app re-renders. */
export function applyTheme(theme: AppTheme | null) {
  const { colors, mode } = theme ?? NEUTRAL_THEME
  const root = document.documentElement
  for (const token of THEME_TOKENS) root.style.setProperty(themeCssVariable(token), colors[token])
  // react-native-web can't apply shadowOpacity to a variable, so the variable carries it.
  root.style.setProperty(themeCssVariable("shadow"), `color-mix(in srgb, ${colors.shadow} ${mode === "dark" ? 40 : 14}%, transparent)`)
  root.style.colorScheme = mode
}
