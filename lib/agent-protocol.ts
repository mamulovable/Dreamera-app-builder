// Types shared by the AppForge agent (server) and the workspace (client).
// The agent route streams `AgentEvent`s as newline-delimited JSON.

import type { Screen } from "@/db/schema"
import type { AppBackend, BackendStatus } from "@/lib/backend-protocol"
import type { UpgradeReason } from "@/lib/plans"
import type { ProjectStatus } from "@/lib/projects"
import type { ThemePackage } from "@/lib/themes"

export const SCREEN_LAYOUTS = ["home", "list", "detail", "profile"] as const
export type ScreenLayout = (typeof SCREEN_LAYOUTS)[number]

export const SCREEN_STATUSES = ["pending", "generating", "done", "failed"] as const
export type ScreenStatus = (typeof SCREEN_STATUSES)[number]

/** How a screen appears in the app's shared tab bar. */
export type ScreenTab = {
  label: string
  /** An Ionicons name, e.g. "home-outline". */
  icon: string
}

export const MIN_TABS = 2
export const MAX_TABS = 5

export type PlannedScreen = {
  /** kebab-case slug, also the Expo Router route (`/${id}`). */
  id: string
  name: string
  purpose: string
  keyElements: string[]
  /** Which wireframe the canvas draws until real previews exist. */
  layout: ScreenLayout
  /** Ids of the screens this one links to. */
  navigatesTo: string[]
  /** Set when the screen is a tab of the shared tab layout. Apps built before that layout have none. */
  tab?: ScreenTab | null
}

export const DATA_FIELD_TYPES = ["string", "number", "boolean", "string[]"] as const
export type DataFieldType = (typeof DATA_FIELD_TYPES)[number]

/** One kind of record the generated app stores, with the sample records it starts with. */
export type DataCollection = {
  /** camelCase plural, e.g. "habits". */
  name: string
  /** PascalCase singular, e.g. "Habit". */
  typeName: string
  /** `references` names the collection whose record id a string field holds. */
  fields: { name: string; type: DataFieldType; references?: string | null }[]
  items: ({ id: string } & Record<string, unknown>)[]
  /** On a cloud backend, whether everyone sees these records. Otherwise each person only sees their own. */
  shared?: boolean
}

/** A piece of UI that screens share, in a file of its own so a change to it doesn't touch them. */
export type AppComponent = {
  /** PascalCase, e.g. "HabitCard". Also its file name. */
  name: string
  purpose: string
  code: string
}

/** Changes to a built app that the current build is still making. */
export type PendingChanges = {
  /** What to change about the app's data, until that's done. */
  data: string | null
  /** What to change about each built screen, by id, until that's done. */
  edits: Record<string, string>
  /** Shared components to write or change, by name, until that's done. */
  components?: Record<string, { purpose: string; request: string }>
  /** Shared components that couldn't be changed, which stay as they were. */
  failed?: string[]
  added: string[]
  updated: string[]
  removed: string[]
}

export type AppPlan = {
  appName: string
  tagline: string
  summary: string
  targetUsers: string
  navigation: "tabs" | "stack"
  design: {
    style: string
    mode: "light" | "dark"
    primaryColor: string
    accentColor: string
    backgroundColor: string
  }
  screens: PlannedScreen[]
  /** The themes the person can switch between. Set when the build starts. */
  themePackage?: ThemePackage
  /** What the app stores, shared by all its screens. Set when the build starts. */
  collections?: DataCollection[]
  /** What the screens are built from. Set when the build starts. Apps built before these existed have none. */
  components?: AppComponent[]
  pendingChanges?: PendingChanges | null
  /** Set once the app runs on its CloudHike backend. Everything in here ships inside the app. */
  backend?: AppBackend | null
}

export type ChatMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  /** Set on the assistant message that proposed (or revised) a plan. */
  plan?: AppPlan | null
}

export type ProjectScreen = {
  id: string
  slug: string
  name: string
  position: number
  status: ScreenStatus
  filePath: string
  layout: ScreenLayout
  code: string | null
}

export function toProjectScreen(row: Screen): ProjectScreen {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    position: row.position,
    status: row.status,
    filePath: row.filePath,
    layout: row.layout,
    code: row.code,
  }
}

/** Whether the screen has finished code to run. A screen waiting for an edit keeps its old code until then. */
export function isRunnable(screen: Pick<ProjectScreen, "status" | "code">) {
  return screen.code !== null && screen.status !== "generating"
}

/** The element selected on the canvas when a message was sent, so "this button" means something. */
export type ElementContext = {
  file: string
  line: number
  /** What the person would call it, such as "Button". */
  label: string
  screen: string
  /** The code that draws it. */
  snippet: string
}

export const MAX_ELEMENT_SNIPPET = 2000

const ELEMENT_BLOCK = /^<selected-element file="([^"]*)" line="(\d+)" label="([^"]*)" screen="([^"]*)">\n[\s\S]*?\n<\/selected-element>\n\n/

const attributeText = (value: string) => value.replace(/["\n]/g, "")

/** A chat message with its element in front of it. It's saved like this, so the agent still knows on later turns. */
export function messageWithElement(content: string, element: ElementContext) {
  const attributes = `file="${attributeText(element.file)}" line="${element.line}" label="${attributeText(element.label)}" screen="${attributeText(element.screen)}"`
  return `<selected-element ${attributes}>\n${element.snippet.slice(0, MAX_ELEMENT_SNIPPET)}\n</selected-element>\n\n${content}`
}

/** What the person wrote, and the element they attached to it. */
export function splitElementMessage(content: string) {
  const match = content.match(ELEMENT_BLOCK)
  if (!match) return { text: content, element: null }
  return { text: content.slice(match[0].length), element: { file: match[1], line: Number(match[2]), label: match[3], screen: match[4] } }
}

/** What the client asks the agent to do. */
export type AgentRequest =
  /** Pick up where the project is: answer a waiting prompt or resume a build. */
  | { action: "start" }
  | { action: "message"; content: string; element?: ElementContext }
  | { action: "confirm" }

export type AgentEvent =
  /** What the agent is doing right now. `null` clears it. */
  | { type: "status"; label: string | null }
  | { type: "reasoning-delta"; delta: string }
  | { type: "text-delta"; delta: string }
  /** The finished assistant reply, as saved. Ends the streamed text. */
  | { type: "message"; message: ChatMessage }
  | { type: "plan"; plan: AppPlan }
  | { type: "project-status"; status: ProjectStatus }
  | { type: "screens"; screens: ProjectScreen[] }
  | { type: "screen"; screen: ProjectScreen }
  | { type: "code-delta"; screenId: string; delta: string }
  | { type: "backend"; backend: BackendStatus }
  | { type: "error"; message: string }
  /** The person hit a plan limit, so they're shown what upgrading gets them. */
  | { type: "upgrade"; reason: UpgradeReason }
  | { type: "done" }

/**
 * Where a planned screen's file lives in the generated Expo Router app. The first screen is the
 * entry. Tabs sit in a route group, which doesn't change their route.
 */
export function screenFilePath(slug: string, position: number, tab?: ScreenTab | null) {
  const folder = tab ? "app/(tabs)" : "app"
  return position === 0 ? `${folder}/index.tsx` : `${folder}/${slug}.tsx`
}

/** Whether the app's tab bar is one shared layout. Tab apps built before it draw the bar in each screen. */
export function hasTabLayout(plan: Pick<AppPlan, "navigation" | "screens">) {
  return plan.navigation === "tabs" && plan.screens.some((screen) => screen.tab)
}

export function screenRoute(slug: string, position: number) {
  return position === 0 ? "/" : `/${slug}`
}

export const COMPONENT_NAME = /^[A-Z][A-Za-z0-9]*$/

export function componentFilePath(name: string) {
  return `components/${name}.tsx`
}

/** Whether this file imports the shared component. */
export function usesComponent(code: string, name: string) {
  return new RegExp(`["']@/components/${name}["']`).test(code)
}

/** A shared component's name as the person would say it: "HabitCard" is "Habit Card". */
export function componentLabel(name: string) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
}
