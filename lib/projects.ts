// Project rules shared by the composer (client) and the projects API (server).

export const PROJECT_PLATFORMS = ["ios-android", "ios", "android"] as const
export type ProjectPlatform = (typeof PROJECT_PLATFORMS)[number]

export const PLATFORM_LABELS: Record<ProjectPlatform, string> = {
  "ios-android": "iOS & Android",
  ios: "iOS only",
  android: "Android only",
}

export function isProjectPlatform(value: unknown): value is ProjectPlatform {
  return PROJECT_PLATFORMS.includes(value as ProjectPlatform)
}

export const PROJECT_STATUSES = ["planning", "building", "ready", "failed"] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export const STATUS_STYLES: Record<ProjectStatus, { label: string; dot: string }> = {
  planning: { label: "Planning", dot: "bg-violet-500" },
  building: { label: "Building", dot: "bg-amber-500 animate-pulse" },
  ready: { label: "Ready", dot: "bg-emerald-500" },
  failed: { label: "Failed", dot: "bg-red-500" },
}

export const MAX_PROJECT_NAME_LENGTH = 80

/** What a project card shows. It has none of the project's prompt or code, unless the prompt is its owner's own description. */
export type ProjectSummary = {
  id: string
  name: string
  description: string
  status: ProjectStatus
  isPublic: boolean
  /** Whether any screen has code to run. */
  hasPreview: boolean
  updatedAt: string
  /** The app's main color, if it has a plan. */
  accentColor: string | null
  role: "owner" | "viewer"
  /** Who made it, for projects that aren't the person's own. */
  owner: string | null
}

export const MAX_PROMPT_LENGTH = 5000
export const MAX_ASSETS = 5
export const MAX_ASSET_SIZE = 10 * 1024 * 1024 // 10 MB

/** Value for the file input's `accept` attribute. */
export const ACCEPTED_ASSET_TYPES = "image/*,.pdf,.txt,.md,.json,.csv"

const ACCEPTED_EXTENSIONS = ["pdf", "txt", "md", "json", "csv"]

/** Browsers often leave `type` empty for .md and friends, so the extension counts too. */
export function isAcceptedAsset(name: string, type: string) {
  if (type.startsWith("image/")) return true
  const extension = name.split(".").pop()?.toLowerCase() ?? ""
  return ACCEPTED_EXTENSIONS.includes(extension)
}

// Phrases people open a prompt with ("Build me an app…", "I want a…").
const LEADING_FILLER =
  /^(?:(?:please|can you|could you|i want(?: to)?|i'd like(?: to)?|i need|let's|help me)\s+)*(?:(?:build|create|make|design|develop|generate)\s+(?:me\s+|us\s+)?)?(?:(?:an|a|the|my|our)\s+)?(?:(?:mobile\s+)?apps?\s+(?:for|to|that)\s+(?:(?:an|a|the)\s+)?)?/i

// Words that end the app's name and start describing it.
const NAME_BREAK =
  /\s(?:app|application|that|which|where|with|for|to|using|so|and|in|on|like|who|featuring|including)\b|[,.;:!?()\-–—]/i

const SMALL_WORDS = new Set(["a", "an", "and", "of", "the", "to", "for", "in", "on", "with"])

function toTitleCase(words: string[]) {
  return words
    .map((word, i) =>
      i > 0 && SMALL_WORDS.has(word.toLowerCase())
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join(" ")
}

/**
 * A short, readable project name from the user's prompt, e.g.
 * "A habit tracker app with daily streaks…" → "Habit Tracker".
 * Falls back to the start of the prompt when no name stands out.
 */
export function projectNameFromPrompt(prompt: string) {
  const firstLine = prompt.trim().split("\n")[0].replace(/\s+/g, " ")
  const subject = firstLine.replace(LEADING_FILLER, "")
  const breakAt = subject.search(NAME_BREAK)
  const words = (breakAt === -1 ? subject : subject.slice(0, breakAt))
    .split(" ")
    .filter(Boolean)
    .slice(0, 4)

  if (words.length === 0) return titleFromPrompt(prompt)
  const name = toTitleCase(words)
  // A one-word name like "Recipe" reads better as "Recipe App".
  return words.length === 1 ? `${name} App` : name
}

/** A short title for a new project, taken from the start of its prompt. */
export function titleFromPrompt(prompt: string, maxLength = 60) {
  const firstLine = prompt.trim().split("\n")[0].replace(/\s+/g, " ")
  if (firstLine.length <= maxLength) return firstLine
  const cut = firstLine.slice(0, maxLength)
  const lastSpace = cut.lastIndexOf(" ")
  return `${(lastSpace > maxLength / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}
