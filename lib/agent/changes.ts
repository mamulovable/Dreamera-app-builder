import { asc, eq, sql } from "drizzle-orm"

import { db, projects, screens, type Screen } from "@/db"
import {
  COMPONENT_NAME,
  componentLabel,
  MAX_TABS,
  MIN_TABS,
  screenFilePath,
  screenRoute,
  type AppPlan,
  type PendingChanges,
  type PlannedScreen,
} from "@/lib/agent-protocol"

/** What the person asked to change about a built app. */
export type AppChangeRequest = {
  appName: string | null
  navigation: AppPlan["navigation"] | null
  addScreens: PlannedScreen[]
  editScreens: (PlannedScreen & { request: string })[]
  removeScreenIds: string[]
  addComponents: { name: string; purpose: string; request: string }[]
  editComponents: { name: string; request: string }[]
  firstScreenId: string | null
  dataChange: string | null
}

export type AppChanges = { plan: AppPlan; removed: string[] }

export function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "screen"
}

/** Treats "Settings", "settings" and "Settings Screen" as the same screen. */
function screenKey(value: string) {
  return slugify(value).replace(/-(screen|page)$/, "")
}

function linksTo(code: string, slug: string) {
  return new RegExp(`["'\`]/${slug}(?:["'\`?])`).test(code)
}

/** The plan after `request`, or why it can't be used. Nothing is saved yet. */
export function planAppChanges(
  plan: AppPlan,
  rows: Pick<Screen, "slug" | "name" | "code">[],
  request: AppChangeRequest,
  maxScreens: number
): AppChanges | string {
  const existing = new Set(plan.screens.map((screen) => screen.id))
  const missing = [...request.editScreens.map((s) => s.id), ...request.removeScreenIds].filter((id) => !existing.has(id))
  if (missing.length > 0) return `These screens don't exist: ${missing.join(", ")}. Use the ids in the current plan.`

  const library = plan.components ?? []
  const earlierComponents = plan.pendingChanges?.components ?? {}
  const knownComponents = new Set([...library.map((component) => component.name), ...Object.keys(earlierComponents)])
  const missingComponents = request.editComponents.map((c) => c.name).filter((name) => !knownComponents.has(name))
  if (missingComponents.length > 0) {
    return `These components don't exist: ${missingComponents.join(", ")}. Use the names in the current plan, or addComponents for a new one.`
  }
  const newNames = request.addComponents.map((c) => c.name)
  const badNames = newNames.filter((name, i) => !COMPONENT_NAME.test(name) || knownComponents.has(name) || newNames.indexOf(name) !== i)
  if (badNames.length > 0) {
    return `Can't add ${badNames.join(", ")}. Each new component needs its own PascalCase name, and editComponents changes one the app already has.`
  }

  const removed = plan.screens.filter((screen) => request.removeScreenIds.includes(screen.id))
  const removedIds = removed.map((screen) => screen.id)
  const edited = new Map(request.editScreens.map((screen) => [screen.id, screen]))

  const taken = new Set(plan.screens.flatMap((screen) => [screenKey(screen.id), screenKey(screen.name)]))
  const repeated: string[] = []
  const idMap = new Map<string, string>()
  const added: PlannedScreen[] = []
  for (const screen of request.addScreens) {
    const id = slugify(screen.id || screen.name)
    const keys = [screenKey(id), screenKey(screen.name)]
    if (keys.some((key) => taken.has(key))) {
      repeated.push(screen.name)
      continue
    }
    keys.forEach((key) => taken.add(key))
    idMap.set(screen.id, id)
    added.push({ ...screen, id })
  }
  if (repeated.length > 0) {
    return `The app already has ${repeated.join(", ")}. Leave ${repeated.length === 1 ? "it" : "them"} out of addScreens and only add what the person's latest message asks for. To change an existing screen, use editScreens.`
  }

  let next = [
    ...plan.screens
      .filter((screen) => !removedIds.includes(screen.id))
      .map((screen) => {
        const edit = edited.get(screen.id)
        if (!edit) return screen
        const { request: _request, ...rest } = edit
        return rest
      }),
    ...added,
  ]
  // An app that's over the limit after a downgrade can still be edited, but not grow.
  if (next.length < 1 || (next.length > maxScreens && next.length > plan.screens.length)) {
    return `That leaves ${next.length} screens. An app has between 1 and ${maxScreens}.`
  }

  // A tab app from before the shared layout draws the bar in its screens, so a layout would be a second bar.
  const drawsOwnTabBars = plan.navigation === "tabs" && !plan.screens.some((screen) => screen.tab)
  if ((request.navigation ?? plan.navigation) === "stack" || drawsOwnTabBars) {
    next = next.map((screen) => ({ ...screen, tab: null }))
  } else {
    const tabs = next.filter((screen) => screen.tab).length
    if (tabs < MIN_TABS || tabs > MAX_TABS) {
      return `That leaves ${tabs} tabs. Tab navigation has between ${MIN_TABS} and ${MAX_TABS}, so set tab on the top-level screens, or use stack navigation.`
    }
  }

  const firstId = request.firstScreenId && (idMap.get(request.firstScreenId) ?? slugify(request.firstScreenId))
  if (firstId) {
    const first = next.find((screen) => screen.id === firstId)
    if (!first) return `There's no screen "${request.firstScreenId}" to open the app on.`
    next = [first, ...next.filter((screen) => screen !== first)]
  }

  const remaining = new Set(next.map((screen) => screen.id))
  next = next.map((screen) => ({
    ...screen,
    navigatesTo: [
      ...new Set(
        screen.navigatesTo.map((id) => idMap.get(id) ?? slugify(id)).filter((id) => remaining.has(id) && id !== screen.id)
      ),
    ],
  }))

  const unreachable = next.filter(
    (screen) =>
      added.some((other) => other.id === screen.id) &&
      !screen.tab &&
      screen.id !== next[0].id &&
      !next.some((other) => other.navigatesTo.includes(screen.id))
  )
  if (unreachable.length > 0) {
    return `Nothing links to ${unreachable.map((screen) => screen.name).join(", ")}, so people couldn't open it. Edit the screen that should open it: list it in that screen's navigatesTo and describe the new link in its request.`
  }

  const edits: Record<string, string> = Object.fromEntries(request.editScreens.map(({ id, request }) => [id, request]))
  // Links to a removed screen would lead nowhere, so those screens change too.
  for (const row of rows) {
    if (!row.code || removedIds.includes(row.slug)) continue
    const gone = removed.filter((screen) => linksTo(row.code!, screen.id))
    if (gone.length === 0) continue
    const note = `The ${gone.map((screen) => screen.name).join(", ")} screen no longer exists. Remove every link to it, and any control that only led there.`
    edits[row.slug] = edits[row.slug] ? `${edits[row.slug]}\n${note}` : note
  }

  // What's still waiting from an earlier change comes first, so this one can build on it.
  const components = { ...earlierComponents }
  const queueComponent = (name: string, purpose: string, text: string) => {
    const waiting = components[name]?.request
    components[name] = { purpose, request: waiting ? `${waiting}\n${text}` : text }
  }
  for (const { name, purpose, request: text } of request.addComponents) queueComponent(name, purpose, text)
  const componentPurpose = (name: string) =>
    library.find((component) => component.name === name)?.purpose ?? earlierComponents[name]?.purpose ?? ""
  for (const { name, request: text } of request.editComponents) queueComponent(name, componentPurpose(name), text)
  // A component with a link to a removed screen would lead nowhere from every screen using it.
  for (const component of library) {
    const gone = removed.filter((screen) => linksTo(component.code, screen.id))
    if (gone.length === 0) continue
    const note = `The ${gone.map((screen) => screen.name).join(", ")} screen no longer exists. Remove every link to it.`
    queueComponent(component.name, component.purpose, note)
  }

  const earlier = plan.pendingChanges
  const earlierEdits = Object.entries(earlier?.edits ?? {}).filter(([slug]) => !removedIds.includes(slug))
  for (const [slug, text] of earlierEdits) edits[slug] = edits[slug] ? `${text}\n${edits[slug]}` : text

  const names = (list: PlannedScreen[]) => list.map((screen) => screen.name)
  const pendingChanges: PendingChanges = {
    data: [earlier?.data, request.dataChange].filter(Boolean).join("\n") || null,
    edits,
    components,
    added: [...new Set([...(earlier?.added ?? []), ...names(added), ...newNames.map(componentLabel)])],
    updated: [
      ...new Set([
        ...(earlier?.updated ?? []),
        ...names(request.editScreens),
        ...request.editComponents.map((c) => componentLabel(c.name)),
      ]),
    ],
    removed: [...new Set([...(earlier?.removed ?? []), ...names(removed)])],
  }

  const { appName, navigation } = request
  return {
    removed: removedIds,
    plan: {
      ...plan,
      ...(appName ? { appName } : {}),
      ...(navigation ? { navigation } : {}),
      screens: next,
      pendingChanges,
    },
  }
}

// A bare "/" is also how dates and paths get split, so it only counts as a route after one of these.
const ENTRY_ROUTE_CONTEXT =
  /(?:\b(?:push|navigate|href|pathname|route|path|to|screen|target)\s*(?:\(\s*|=\s*\{?\s*|:\s*)|\brouter\.replace\(\s*)$/
const ROUTE_LITERAL = /(["'`])(\/[a-z0-9-]*)\1/g

/** Points a screen's links at the routes of screens that moved. */
export function rewriteRoutes(code: string, moved: Map<string, string>) {
  if (moved.size === 0) return code
  return code.replace(ROUTE_LITERAL, (match, quote: string, route: string, offset: number) => {
    const next = moved.get(route)
    if (!next) return match
    if (route === "/" && !ENTRY_ROUTE_CONTEXT.test(code.slice(Math.max(0, offset - 40), offset))) return match
    return `${quote}${next}${quote}`
  })
}

/** Changes these top-level values of the saved plan and leaves the rest, such as a theme switched meanwhile. */
export async function mergePlan(projectId: string, changes: Partial<AppPlan>) {
  const [project] = await db
    .update(projects)
    .set({ plan: sql`${projects.plan} || ${JSON.stringify(changes)}::jsonb` })
    .where(eq(projects.id, projectId))
    .returning({ plan: projects.plan })
  return project.plan!
}

/**
 * Saves the changes and queues the work: new screens and edited screens wait for
 * the build, and an edited screen keeps its code until its new code is ready.
 */
export async function applyAppChanges(projectId: string, { plan, removed }: AppChanges) {
  const edits = plan.pendingChanges?.edits ?? {}
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(screens).where(eq(screens.projectId, projectId)).orderBy(asc(screens.position))
    const bySlug = new Map(rows.map((row) => [row.slug, row]))

    const moved = new Map<string, string>()
    plan.screens.forEach((screen, position) => {
      const row = bySlug.get(screen.id)
      const route = screenRoute(screen.id, position)
      if (row && screenRoute(row.slug, row.position) !== route) moved.set(screenRoute(row.slug, row.position), route)
    })

    for (const slug of removed) {
      await tx.delete(screens).where(eq(screens.id, bySlug.get(slug)!.id))
    }
    for (const [position, screen] of plan.screens.entries()) {
      const row = bySlug.get(screen.id)
      const values = {
        name: screen.name,
        position,
        layout: screen.layout,
        filePath: screenFilePath(screen.id, position, screen.tab),
      }
      if (!row) {
        await tx.insert(screens).values({ ...values, projectId, slug: screen.id })
        continue
      }
      await tx
        .update(screens)
        .set({
          ...values,
          code: row.code && rewriteRoutes(row.code, moved),
          status: screen.id in edits ? "pending" : row.status,
        })
        .where(eq(screens.id, row.id))
    }

    const { themePackage: _themePackage, backend: _backend, ...changes } = plan
    if (changes.components) {
      changes.components = changes.components.map((c) => ({ ...c, code: rewriteRoutes(c.code, moved) }))
    }
    const [project] = await tx
      .update(projects)
      .set({ plan: sql`${projects.plan} || ${JSON.stringify(changes)}::jsonb` })
      .where(eq(projects.id, projectId))
      .returning({ plan: projects.plan })
    return project.plan!
  })
}
