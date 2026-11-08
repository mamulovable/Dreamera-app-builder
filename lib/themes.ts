// The theme system shared by the agent, the workspace, and the preview runtime.
// Screens only ever use token names, so changing theme never touches their code.

/** The colors the agent picks for a theme. */
export const BASE_THEME_TOKENS = [
  "background",
  "surface",
  "surfaceAlt",
  "border",
  "text",
  "textMuted",
  "primary",
  "accent",
  "success",
  "warning",
  "danger",
] as const

/** Every token a screen can use: the base colors plus the ones worked out from them. */
export const THEME_TOKENS = [
  ...BASE_THEME_TOKENS,
  "onPrimary",
  "onAccent",
  "primarySoft",
  "accentSoft",
  "successSoft",
  "warningSoft",
  "dangerSoft",
  "overlay",
  "shadow",
] as const

export type BaseThemeToken = (typeof BASE_THEME_TOKENS)[number]
export type ThemeToken = (typeof THEME_TOKENS)[number]
export type ThemeMode = "light" | "dark"

export type AppTheme = {
  id: string
  name: string
  mode: ThemeMode
  colors: Record<ThemeToken, string>
}

export type ThemePackage = {
  activeThemeId: string
  themes: AppTheme[]
}

export type DesignColors = {
  mode: ThemeMode
  primaryColor: string
  accentColor: string
  backgroundColor: string
}

export const HEX_COLOR = /^#[0-9a-f]{6}$/i

function toRgb(hex: string) {
  const value = parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

/** `amount` of `from` over `to`, as a hex color. */
function mix(from: string, to: string, amount: number) {
  const a = toRgb(from)
  const b = toRgb(to)
  const channels = a.map((channel, i) => Math.round(channel * amount + b[i] * (1 - amount)))
  return `#${channels.map((c) => c.toString(16).padStart(2, "0")).join("")}`
}

function luminance(hex: string) {
  const [r, g, b] = toRgb(hex).map((channel) => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

/** Black or white, whichever reads better on `background`. */
function readableOn(background: string) {
  return contrastRatio(background, "#ffffff") >= contrastRatio(background, "#0b0b0f") ? "#ffffff" : "#0b0b0f"
}

/** `color`, moved toward black or white until it's readable on `background`. */
function ensureContrast(color: string, background: string, minimum: number) {
  const target = readableOn(background)
  for (let amount = 0; amount <= 1; amount += 0.1) {
    const candidate = mix(target, color, amount)
    if (contrastRatio(candidate, background) >= minimum) return candidate
  }
  return target
}

/** The full set of tokens for a theme, with text kept readable whatever colors came in. */
export function completeTheme(
  theme: Pick<AppTheme, "id" | "name" | "mode"> & { colors: Record<BaseThemeToken, string> }
): AppTheme {
  const { colors } = theme
  const soft = (color: string) => mix(color, colors.surface, theme.mode === "dark" ? 0.24 : 0.14)
  return {
    id: theme.id,
    name: theme.name,
    mode: theme.mode,
    colors: {
      ...colors,
      text: ensureContrast(colors.text, colors.background, 7),
      textMuted: ensureContrast(colors.textMuted, colors.surface, 4.5),
      onPrimary: readableOn(colors.primary),
      onAccent: readableOn(colors.accent),
      primarySoft: soft(colors.primary),
      accentSoft: soft(colors.accent),
      successSoft: soft(colors.success),
      warningSoft: soft(colors.warning),
      dangerSoft: soft(colors.danger),
      overlay: theme.mode === "dark" ? "#00000099" : "#0b0b0f66",
      shadow: theme.mode === "dark" ? "#000000" : mix(colors.primary, "#0b0b0f", 0.2),
    },
  }
}

/** The theme a plan's three design colors describe. */
export function themeFromDesign(design: DesignColors): AppTheme {
  const { mode, primaryColor: primary, accentColor: accent, backgroundColor: background } = design
  const dark = mode === "dark"
  const ink = dark ? "#ffffff" : "#0b0b0f"
  return completeTheme({
    id: "default",
    name: "Default",
    mode,
    colors: {
      background,
      surface: dark ? mix(ink, background, 0.07) : mix("#ffffff", background, 0.8),
      surfaceAlt: mix(ink, background, dark ? 0.12 : 0.05),
      border: mix(ink, background, dark ? 0.16 : 0.1),
      text: mix(ink, background, 0.94),
      textMuted: mix(ink, background, 0.62),
      primary,
      accent,
      success: dark ? "#34d399" : "#059669",
      warning: dark ? "#fbbf24" : "#d97706",
      danger: dark ? "#f87171" : "#dc2626",
    },
  })
}

const PRESET_THEMES: (Pick<AppTheme, "id" | "name"> & DesignColors)[] = [
  { id: "ocean", name: "Ocean", mode: "light", primaryColor: "#0369a1", accentColor: "#0d9488", backgroundColor: "#f4f9fc" },
  { id: "forest", name: "Forest", mode: "light", primaryColor: "#166534", accentColor: "#ca8a04", backgroundColor: "#f6f8f3" },
  { id: "sunset", name: "Sunset", mode: "light", primaryColor: "#c2410c", accentColor: "#be185d", backgroundColor: "#fdf7f3" },
  { id: "midnight", name: "Midnight", mode: "dark", primaryColor: "#818cf8", accentColor: "#22d3ee", backgroundColor: "#0b1020" },
]

/** A working package built from the plan alone, for when the agent's one can't be used. */
export function fallbackThemePackage(design: DesignColors): ThemePackage {
  const presets = PRESET_THEMES.map(({ id, name, ...colors }) => ({ ...themeFromDesign(colors), id, name }))
  return { activeThemeId: "default", themes: [themeFromDesign(design), ...presets] }
}

export function activeTheme(themePackage: ThemePackage | null | undefined) {
  if (!themePackage) return null
  return themePackage.themes.find((t) => t.id === themePackage.activeThemeId) ?? themePackage.themes[0] ?? null
}

/** The CSS variable behind a token, e.g. `surfaceAlt` is `--color-surface-alt`. */
export function themeCssVariable(token: string) {
  return `--color-${token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`
}
