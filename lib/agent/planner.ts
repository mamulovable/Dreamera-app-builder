import { Agent, assistant, run, tool, user, type AgentInputItem } from "@openai/agents"
import { and, eq } from "drizzle-orm"
import { z } from "zod"

import { db, messages, projects, screens, type Project, type Screen } from "@/db"
import {
  APP_NAVIGATIONS,
  componentFilePath,
  formatAssistantMessage,
  MAX_TABS,
  MIN_TABS,
  parseAssistantMessage,
  parseMessageContent,
  SCREEN_LAYOUTS,
  type AppPlan,
  type ChangePlan,
  type ChatMessage,
  type PlanQuestion,
} from "@/lib/agent-protocol"
import { mergePlan, planAppChanges, slugify, type AppChanges } from "@/lib/agent/changes"
import { withBuilderCall } from "@/lib/agent/call-scope"
import { configureAgents, DEFAULT_SCREEN_COUNT, PLANNER_MODEL } from "@/lib/agent/config"
import { plannerInstructions, type PlannerState } from "@/lib/agent/instructions"
import { aiProvidersConfigured } from "@/lib/ai/providers"
import type { ProjectRun } from "@/lib/agent/runs"
import { BACKEND_SERVICES } from "@/lib/backend-protocol"
import { screenLimitMessage } from "@/lib/billing/credits"
import { getBackendStatus, setUpBackend } from "@/lib/cloudhike/backend"
import { buildCost, PLANS } from "@/lib/plans"
import { DocsFetchError, fetchPublicDocs } from "@/lib/fetch-docs"
import { listSecretNames, normalizeSecretName } from "@/lib/project-secrets"
import { isHtmlWebsite, MAX_PROJECT_NAME_LENGTH } from "@/lib/projects"
import { HEX_COLOR, themeFromDesign } from "@/lib/themes"

type PlannerContext = Omit<PlannerState, "rows"> & {
  project: Project
  projectId: string
  run: ProjectRun
  rows: Pick<Screen, "slug" | "name" | "filePath" | "code">[]
  /** The plan proposed during this turn, saved with the reply. */
  proposedPlan: AppPlan | null
  /** Interactive planning questions asked during this turn, saved with the reply. */
  proposedQuestions: PlanQuestion[] | null
  /** Change plan proposed on a built project in Plan mode, saved with the reply. */
  proposedChangePlan: ChangePlan | null
  confirmed: boolean
  /** The changes to a built app asked for during this turn, made right after the reply. */
  changes: AppChanges | null
}

const screenSchema = z.object({
  id: z.string().describe("Unique kebab-case slug, e.g. 'workout-detail'"),
  name: z.string().describe("Screen name, e.g. 'Workout Detail'"),
  purpose: z.string().describe("One sentence on what the user does here"),
  keyElements: z.array(z.string()).describe("3 to 6 concrete UI elements with real content"),
  layout: z
    .enum(SCREEN_LAYOUTS)
    .describe(
      "Closest wireframe. Mobile: home, list, detail, profile. Website: landing (marketing home), content (about/pricing/docs), dashboard (signed-in overview), plus home, list, detail, profile when they fit."
    ),
  navigatesTo: z.array(z.string()).describe("Ids of screens this screen links to"),
  tab: z
    .object({
      label: z.string().describe("Short nav label, e.g. 'Home'"),
      icon: z.string().describe("Ionicons outline name, e.g. 'home-outline'"),
    })
    .nullable()
    .describe(
      "How this screen appears in the shared nav (mobile tab bar, website top nav, or sidebar), or null if it isn't a top-level item"
    ),
})

// No min/max/regex constraints: not every model behind CloudHike accepts them
// in strict tool schemas. `propose_plan` checks the rules itself instead.
const planSchema = z.object({
  appName: z.string().describe("Short, brandable app or site name"),
  tagline: z.string().describe("One line describing the app or site"),
  summary: z.string().describe("2 to 3 sentences: what it does and its core user journeys"),
  targetUsers: z.string().describe("Who it is for"),
  navigation: z
    .enum(APP_NAVIGATIONS)
    .describe("Mobile: tabs or stack. Website: top-nav or sidebar."),
  design: z.object({
    style: z.string().describe("Visual style in a few words, e.g. 'calm, minimal, rounded cards'"),
    mode: z.enum(["light", "dark"]),
    primaryColor: z.string().describe("Hex color, e.g. #6D28D9"),
    accentColor: z.string().describe("Hex color"),
    backgroundColor: z.string().describe("Hex color"),
  }),
  screens: z
    .array(screenSchema)
    .describe(`At most ${DEFAULT_SCREEN_COUNT}, plus a default Sign In screen when needed, unless the person explicitly asks for more, in build order. The first one is where the app or site opens.`),
})

const appChangesSchema = z.object({
  appName: z.string().nullable().describe("The new app name, or null to keep it"),
  navigation: z.enum(APP_NAVIGATIONS).nullable().describe("The new navigation style, or null to keep it"),
  addScreens: z
    .array(screenSchema)
    .describe("New screens the person's latest message asks for. Never a screen the current plan already has."),
  editScreens: z
    .array(
      screenSchema.extend({
        id: z.string().describe("The id of a screen in the current plan. It can't change, even when renaming."),
        request: z.string().describe("Exactly what to change in this screen's code, with every detail the person gave"),
      })
    )
    .describe("Existing screens to change, each with its complete updated details and what to change"),
  removeScreenIds: z.array(z.string()).describe("Ids of screens to delete"),
  addComponents: z
    .array(
      z.object({
        name: z.string().describe("New PascalCase name, e.g. 'RatingStars'"),
        purpose: z.string().describe("One sentence on what it draws"),
        request: z.string().describe("What it looks like, what it does, and the props screens will pass it"),
      })
    )
    .describe("New shared components that several screens need. Name them in the request of each screen that should use them."),
  editComponents: z
    .array(
      z.object({
        name: z.string().describe("The name of a shared component the app has"),
        request: z.string().describe("Exactly what to change in this component's code, with every detail the person gave"),
      })
    )
    .describe("Shared components to change. Every screen using one updates without being rewritten, so prefer this to editScreens."),
  firstScreenId: z.string().nullable().describe("Id of the screen the app should now open on, or null to keep it"),
  dataChange: z
    .string()
    .nullable()
    .describe("What the app needs to store that it doesn't yet: new collections or fields, with sample data ideas. Null if nothing."),
})

const themeSchema = z.object({
  themeId: z.string().nullable().describe("The id of an existing theme to switch to, or null when making a new one"),
  newTheme: z
    .object({
      name: z.string().describe("Short evocative name"),
      mode: z.enum(["light", "dark"]),
      primaryColor: z.string().describe("Hex color, e.g. #6D28D9"),
      accentColor: z.string().describe("Hex color"),
      backgroundColor: z.string().describe("Hex color"),
    })
    .nullable()
    .describe("Colors for a new theme to add and switch to, or null when using an existing theme"),
})

const backendSchema = z.object({
  services: z
    .array(z.enum(BACKEND_SERVICES))
    .describe("Services the person asked for by name. What the screens need is added for you, so this is often empty."),
  sharedCollections: z
    .array(z.string())
    .nullable()
    .describe("Names of the collections everyone should see the same records of, or null to keep them as they are"),
  acceptEmailPolicy: z.boolean().describe("True only if the person's latest message accepts CloudHike's email policy"),
})

/** Tidies a proposed plan, or returns why it can't be used. */
function normalizePlan(input: z.infer<typeof planSchema>, maxScreens: number): AppPlan | string {
  if (input.screens.length < 1 || input.screens.length > maxScreens) {
    return `The plan has ${input.screens.length} screens. Plan between 1 and ${maxScreens}.`
  }
  for (const [key, color] of Object.entries(input.design)) {
    if (key.endsWith("Color") && !HEX_COLOR.test(color)) {
      return `design.${key} must be a 6-digit hex color like #6D28D9, not "${color}".`
    }
  }

  const tabs = input.screens.filter((screen) => screen.tab).length
  const usesSharedNav =
    input.navigation === "tabs" || input.navigation === "top-nav" || input.navigation === "sidebar"
  if (usesSharedNav && (tabs < MIN_TABS || tabs > MAX_TABS)) {
    const kind =
      input.navigation === "tabs" ? "tabs" : input.navigation === "sidebar" ? "sidebar items" : "top-nav items"
    return `The plan has ${tabs} ${kind}. Shared navigation has between ${MIN_TABS} and ${MAX_TABS} top-level items, so set tab on those pages, or pick a different navigation style.`
  }

  const used = new Set<string>()
  const idMap = new Map<string, string>()
  const screens = input.screens.map((screen) => {
    let id = slugify(screen.id || screen.name)
    for (let n = 2; used.has(id); n++) id = `${slugify(screen.id || screen.name)}-${n}`
    used.add(id)
    idMap.set(screen.id, id)
    return { ...screen, id, tab: usesSharedNav ? screen.tab : null }
  })
  for (const screen of screens) {
    screen.navigatesTo = [
      ...new Set(screen.navigatesTo.map((id) => idMap.get(id) ?? slugify(id)).filter((id) => used.has(id) && id !== screen.id)),
    ]
  }
  return { ...input, screens }
}

const UPGRADE_NOTE = "The person now sees a popup about upgrading to Pro, so mention it in one short sentence and don't repeat what it says."

/** For a request Free's screen limit stops. Pro has nothing to upgrade to, so it only gets the reason. */
function screenLimitReached(ctx: PlannerContext) {
  if (ctx.account.plan !== "free") return screenLimitMessage(ctx.account.plan)
  ctx.run.emit({ type: "upgrade", reason: "screens" })
  return `${screenLimitMessage(ctx.account.plan)} ${UPGRADE_NOTE}`
}

/** Checks there's enough for this work, so the reply can say so. The build itself is what charges for it. */
function creditsMissing(ctx: PlannerContext, plan: AppPlan) {
  const cost = buildCost(plan, ctx.rows)
  if (cost <= ctx.account.credits) return null
  ctx.run.emit({ type: "upgrade", reason: "credits" })
  return `This costs ${cost} credits and the person has ${ctx.account.credits}. ${UPGRADE_NOTE}`
}

const proposePlan = tool<typeof planSchema, PlannerContext>({
  name: "propose_plan",
  description:
    "Show the person the app plan (or a revised plan) as a card in the chat, with a button to confirm it. Always pass the complete plan.",
  parameters: planSchema,
  async execute(input, runContext) {
    const ctx = runContext!.context
    if (ctx.status === "building") return "The app is being built right now, so the plan can't change."
    if (ctx.builtScreens > 0) return "The app is already built. Use update_app to change it, which keeps the finished screens."

    if (input.screens.length > PLANS[ctx.account.plan].maxScreens) {
      return `Plan not saved: ${screenLimitReached(ctx)} Call propose_plan again with what matters most within the limit, folding the rest into those screens.`
    }
    const plan = normalizePlan(input, PLANS[ctx.account.plan].maxScreens)
    if (typeof plan === "string") return `Plan not saved: ${plan} Fix it and call propose_plan again.`

    await db
      .update(projects)
      .set({ plan, title: plan.appName.slice(0, MAX_PROJECT_NAME_LENGTH), status: "planning" })
      .where(eq(projects.id, ctx.projectId))
    if (ctx.status !== "planning") ctx.run.emit({ type: "project-status", status: "planning" })
    ctx.plan = plan
    ctx.status = "planning"
    ctx.proposedPlan = plan
    ctx.run.emit({ type: "plan", plan })
    const noun = isHtmlWebsite(ctx.platform) ? "pages" : "screens"
    return `Plan saved. The person now sees it as a card listing all ${plan.screens.length} ${noun}, with a "Confirm & build" button.`
  },
})

const confirmPlan = tool<z.ZodObject<Record<string, never>>, PlannerContext>({
  name: "confirm_plan",
  description:
    "Start building the app from the current plan. Only call this when the person's latest message clearly approves the plan.",
  parameters: z.object({}),
  async execute(_input, runContext) {
    const ctx = runContext!.context
    if (!ctx.plan) return "There's no plan to confirm yet. Propose one first."
    if (ctx.status === "building" || ctx.status === "ready") return "The app is already built or being built."
    const missing = creditsMissing(ctx, ctx.plan)
    if (missing) return `Not started: ${missing}`
    ctx.confirmed = true
    const noun = isHtmlWebsite(ctx.platform) ? "page" : "screen"
    return `Confirmed. The build starts right after your reply, one ${noun} at a time.`
  },
})

const updateApp = tool<typeof appChangesSchema, PlannerContext>({
  name: "update_app",
  description:
    "Change the built app: add, edit, rename, or remove screens, add or edit its shared components, choose the screen it opens on, and add to its data. Put everything the person's latest message asks for in one call, and nothing from earlier messages. The work starts right after your reply.",
  parameters: appChangesSchema,
  async execute(input, runContext) {
    const ctx = runContext!.context
    if (ctx.status === "building") return "The app is being built right now, so wait until it finishes."
    if (!ctx.plan || ctx.builtScreens === 0) return "No screens are built yet. Plan the app with propose_plan instead."
    if (ctx.changes) return "The changes are already queued. Tell the person what's being done."

    const screenCount = ctx.plan.screens.length + input.addScreens.length - input.removeScreenIds.length
    if (input.addScreens.length > 0 && screenCount > PLANS[ctx.account.plan].maxScreens) {
      return `Nothing changed: ${screenLimitReached(ctx)} Offer to fold this into an existing screen, or to replace a screen.`
    }
    const changes = planAppChanges(ctx.plan, ctx.rows, input, PLANS[ctx.account.plan].maxScreens)
    if (typeof changes === "string") return `Nothing changed: ${changes} Fix it and call update_app again.`
    const missing = creditsMissing(ctx, changes.plan)
    if (missing) return `Nothing changed: ${missing}`
    ctx.changes = changes
    return "Queued. The changes start right after your reply, so don't say they're finished yet."
  },
})

const setTheme = tool<typeof themeSchema, PlannerContext>({
  name: "set_theme",
  description: "Switch the whole app to one of its themes, or add a new theme and switch to it. It applies straight away, with no screen rebuilt.",
  parameters: themeSchema,
  async execute({ themeId, newTheme }, runContext) {
    const ctx = runContext!.context
    const themePackage = ctx.plan?.themePackage
    if (!themePackage) return "This app has no themes yet, because it was built before they existed."

    let next = themePackage
    if (newTheme) {
      const colors = [newTheme.primaryColor, newTheme.accentColor, newTheme.backgroundColor]
      if (!colors.every((color) => HEX_COLOR.test(color))) return "Theme not saved: colors must be 6-digit hex values like #6D28D9."
      let id = slugify(newTheme.name)
      for (let n = 2; themePackage.themes.some((theme) => theme.id === id); n++) id = `${slugify(newTheme.name)}-${n}`
      const theme = { ...themeFromDesign(newTheme), id, name: newTheme.name }
      next = { activeThemeId: id, themes: [...themePackage.themes, theme] }
    } else if (themeId && themePackage.themes.some((theme) => theme.id === themeId)) {
      next = { ...themePackage, activeThemeId: themeId }
    } else {
      return `Theme not saved: use one of these ids: ${themePackage.themes.map((theme) => theme.id).join(", ")}.`
    }

    ctx.plan = await mergePlan(ctx.projectId, { themePackage: next })
    ctx.run.emit({ type: "plan", plan: ctx.plan })
    return "Done. The whole app now uses this theme."
  },
})

// The agent only gets this tool, and not CloudHike's MCP tools directly: those can read the
// project's secrets and reach every project in the person's workspace.
const setupBackend = tool<typeof backendSchema, PlannerContext>({
  name: "setup_backend",
  description:
    "Deploy the app's CloudHike backend and connect the app to it, so its data is stored in the cloud and syncs live. Adds only what's missing. Waits until the services are running.",
  parameters: backendSchema,
  async execute({ services, sharedCollections, acceptEmailPolicy }, runContext) {
    const ctx = runContext!.context
    if (isHtmlWebsite(ctx.platform)) return "Website v2 doesn't connect CloudHike yet. The pages keep their data in the browser."
    if (ctx.status === "building") return "The app is being built right now, and the backend is set up when that finishes."
    if (ctx.builtScreens === 0) return "No screens are built yet. The backend is set up on its own once the build finishes."
    if (!ctx.backend.accountConnected || ctx.backend.state === "disconnected") {
      return "CloudHike isn't connected. Ask the person to click Connect Backend at the top of the workspace."
    }
    if (services.includes("email") && !acceptEmailPolicy && !ctx.backend.services.some((service) => service.type === "email")) {
      return "Nothing was deployed. Email needs the person to accept https://cloudhike.dev/legal/email-policy first. Ask them, or call this again without email."
    }

    if (sharedCollections && ctx.plan?.collections) {
      const collections = ctx.plan.collections.map((c) => ({ ...c, shared: sharedCollections.includes(c.name) }))
      ctx.plan = await mergePlan(ctx.projectId, { collections })
    }
    const result = await setUpBackend(ctx.project, { services, acceptEmailPolicy, emit: (event) => ctx.run.emit(event) })
    ctx.backend = await getBackendStatus(ctx.projectId, ctx.project.userId)
    if (!result.ok) return `The backend wasn't set up: ${result.message}`
    ctx.plan = result.plan
    return `Done. The app now saves to CloudHike, and these are running: ${result.services.map((service) => service.type).join(", ")}. Data people saved on the device isn't moved over.`
  },
})

const planQuestionOptionSchema = z.object({
  id: z.string().describe("Short kebab-case option id, e.g. 'opt-1'"),
  label: z.string().describe("Short, scannable option title (2 to 7 words)"),
  description: z.string().describe("One concise sentence explaining this choice — or why you recommend it when recommended is true"),
  recommended: z.boolean().describe("True ONLY for the single option you genuinely recommend most for this prompt"),
})

const planQuestionSchema = z.object({
  id: z.string().describe("Unique kebab-case question id, e.g. 'app-name'"),
  stepLabel: z.string().describe("Short step badge, e.g. 'App Name', 'Core Flow', 'Layout', 'Visual Style', 'Final Result'"),
  question: z.string().describe("Clear, concise question text for the person"),
  options: z.array(planQuestionOptionSchema).describe("Exactly 4 options, with the recommended option first"),
})

const askPlanQuestionsSchema = z.object({
  questions: z
    .array(planQuestionSchema)
    .describe("Ordered planning questions walking from the app/site name to the final result, strictly within the person's prompt"),
})

const changePlanSchema = z.object({
  title: z.string().describe("Short title for the planned change"),
  summary: z.string().describe("One sentence summarizing what will change"),
  items: z.array(z.string()).describe("2 to 5 concrete bullet items describing the exact changes to build"),
})

const readFileSchema = z.object({
  path: z.string().describe("Project file path to inspect, e.g. 'app/(tabs)/index.tsx', 'components/HabitCard.tsx', or 'index.html'"),
})

const askPlanQuestions = tool<typeof askPlanQuestionsSchema, PlannerContext>({
  name: "ask_plan_questions",
  description:
    "Present interactive 4-option multiple-choice planning questions (with your top recommendation highlighted first) so the person can plan step by step before building.",
  parameters: askPlanQuestionsSchema,
  async execute({ questions }, runContext) {
    const ctx = runContext!.context
    if (questions.length < 1 || questions.length > 6) {
      return `Questions not shown: pass between 1 and 6 questions (got ${questions.length}). Call ask_plan_questions again.`
    }
    for (const q of questions) {
      if (q.options.length < 3) {
        return `Questions not shown: "${q.stepLabel}" only has ${q.options.length} options. Provide 4 options per question with your top recommendation marked recommended: true.`
      }
    }
    const normalized: PlanQuestion[] = questions.map((q, qi) => {
      const sliced = q.options.slice(0, 4)
      const recIndex = Math.max(
        sliced.findIndex((o) => o.recommended),
        0
      )
      const ordered = [
        sliced[recIndex],
        ...sliced.filter((_, idx) => idx !== recIndex),
      ].map((opt, oi) => ({
        id: slugify(opt.id || `option-${oi + 1}`) || `opt-${oi + 1}`,
        label: opt.label.trim(),
        description: opt.description.trim(),
        recommended: oi === 0,
      }))
      return {
        id: slugify(q.id || q.stepLabel || `q-${qi + 1}`) || `q-${qi + 1}`,
        stepLabel: q.stepLabel.trim() || `Step ${qi + 1}`,
        question: q.question.trim(),
        options: ordered,
      }
    })
    ctx.proposedQuestions = normalized
    return `Questions displayed as an interactive ${normalized.length}-step card in the chat. Write only 1 or 2 short introductory sentences and do NOT list the questions or options in plain text.`
  },
})

const proposeChangePlan = tool<typeof changePlanSchema, PlannerContext>({
  name: "propose_change_plan",
  description:
    "Show a structured change plan card for an already-built project in Plan mode, with a 'Confirm & build changes' button.",
  parameters: changePlanSchema,
  async execute(input, runContext) {
    const ctx = runContext!.context
    const items = input.items.map((item) => item.trim()).filter(Boolean)
    if (!input.title.trim() || items.length === 0) {
      return "Change plan not saved: provide a title and at least one concrete change item."
    }
    ctx.proposedChangePlan = {
      title: input.title.trim(),
      summary: input.summary.trim(),
      items: items.slice(0, 8),
    }
    return `Change plan saved and shown as a card with a "Confirm & build changes" button. Write 1 or 2 short sentences inviting the person to confirm or request adjustments.`
  },
})

const readProjectFile = tool<typeof readFileSchema, PlannerContext>({
  name: "read_project_file",
  description:
    "Read the current source code of a built screen, page, shared component, or stylesheet in this project so you can answer questions accurately or suggest tailored edits.",
  parameters: readFileSchema,
  async execute({ path }, runContext) {
    const ctx = runContext!.context
    const target = path.trim()
    const screenRow = ctx.rows.find(
      (r) => r.code && (r.filePath === target || r.slug === target || r.name.toLowerCase() === target.toLowerCase())
    )
    if (screenRow?.code) return `# ${screenRow.filePath} (${screenRow.name})\n${screenRow.code}`

    const component = ctx.plan?.components?.find(
      (c) => componentFilePath(c.name) === target || c.name === target
    )
    if (component?.code) return `# ${componentFilePath(component.name)}\n${component.code}`

    if (target === "site.css" && ctx.plan?.site?.css) return `# site.css\n${ctx.plan.site.css}`
    if (target === "site.js" && ctx.plan?.site?.js) return `# site.js\n${ctx.plan.site.js}`

    const available = [
      ...ctx.rows.filter((r) => r.code).map((r) => r.filePath),
      ...(ctx.plan?.components?.map((c) => componentFilePath(c.name)) ?? []),
      ...(ctx.plan?.site?.css ? ["site.css"] : []),
      ...(ctx.plan?.site?.js ? ["site.js"] : []),
    ]
    return available.length > 0
      ? `File "${target}" not found. Available files: ${available.join(", ")}`
      : "No files have been built in this project yet."
  },
})

const listSecretNamesTool = tool<z.ZodObject<Record<string, never>>, PlannerContext>({
  name: "list_secret_names",
  description:
    "List the external API key names already stored for this app (names and labels only — never values).",
  parameters: z.object({}),
  async execute(_input, runContext) {
    const ctx = runContext!.context
    const secrets = await listSecretNames(ctx.projectId)
    if (secrets.length === 0) return "No external API keys are stored yet."
    return secrets.map((secret) => `${secret.name}${secret.label ? ` (${secret.label})` : ""}`).join(", ")
  },
})

const requestSecretSchema = z.object({
  name: z.string().describe("Uppercase env-style name, e.g. OPENWEATHER_API_KEY"),
  label: z.string().describe("Short human label, e.g. OpenWeather"),
  reason: z.string().describe("One sentence why this app needs the key"),
})

const requestSecret = tool<typeof requestSecretSchema, PlannerContext>({
  name: "request_secret",
  description:
    "Open the API keys dialog for a third-party key (weather, maps, etc.). Use proactively when the app needs live external data — even if they didn't ask for an API. Never ask them to paste the key in chat. You never receive the value.",
  parameters: requestSecretSchema,
  async execute({ name, label, reason }, runContext) {
    const ctx = runContext!.context
    if (isHtmlWebsite(ctx.platform)) {
      return "Website v2 can't store or proxy external API keys yet. Explain that in plain words and keep the site on sample or typed-in data."
    }
    const normalized = normalizeSecretName(name)
    if (!normalized) {
      return "Key name rejected. Use an uppercase name like OPENWEATHER_API_KEY (letters, numbers, underscores)."
    }
    const existing = await listSecretNames(ctx.projectId)
    if (existing.some((secret) => secret.name === normalized)) {
      return `${normalized} is already stored. Tell the person they can replace it from Keys at the top of the workspace, then wire the screen with callExternalApi from "@/lib/external" (and call update_app if screens aren't using it yet).`
    }
    ctx.run.emit({
      type: "secret-request",
      name: normalized,
      label: label.trim() || normalized,
    })
    return `The API keys dialog is open for ${normalized} (${reason.trim() || "external API"}). In your reply, give a short get-the-key guide (provider site / signup / copy key / paste under Keys). Never ask them to paste it in chat. After they save it, call update_app so screens use callExternalApi from "@/lib/external" with secretName ${normalized}. Prefer fetch_docs on the provider docs before inventing endpoints.`
  },
})

const fetchDocsSchema = z.object({
  url: z
    .string()
    .describe("Full https URL of official API docs, e.g. https://openweathermap.org/current or https://openrouter.ai/docs"),
})

const fetchDocs = tool<typeof fetchDocsSchema, PlannerContext>({
  name: "fetch_docs",
  description:
    "Fetch a public https documentation page and return plain text (HTML stripped). Use before wiring an unfamiliar third-party API (OpenWeather, OpenRouter, etc.) so endpoints and auth match the provider. Do not fetch login pages or paste keys.",
  parameters: fetchDocsSchema,
  async execute({ url }) {
    try {
      const docs = await fetchPublicDocs(url)
      return `# ${docs.title}\nSource: ${docs.url}\n\n${docs.text}`
    } catch (error) {
      if (error instanceof DocsFetchError) return `Docs not loaded: ${error.message}`
      console.error("fetch_docs failed", error)
      return "Docs not loaded: something went wrong fetching that page."
    }
  },
})

function toolsForTurn(ctx: PlannerContext) {
  if (ctx.mode === "chat") {
    const hasFiles = ctx.builtScreens > 0 || Boolean(ctx.plan?.components?.length) || Boolean(ctx.plan?.site?.css)
    return hasFiles ? [readProjectFile, listSecretNamesTool, fetchDocs] : [listSecretNamesTool, fetchDocs]
  }
  if (ctx.mode === "plan") {
    if (ctx.builtScreens === 0) {
      if (!ctx.plan && !ctx.justAnsweredQuestions) {
        return [askPlanQuestions]
      }
      return ctx.plan ? [proposePlan, askPlanQuestions, confirmPlan, fetchDocs] : [proposePlan, askPlanQuestions, fetchDocs]
    }
    return [askPlanQuestions, proposeChangePlan, readProjectFile, listSecretNamesTool, requestSecret, fetchDocs]
  }
  return [proposePlan, confirmPlan, updateApp, setTheme, setupBackend, listSecretNamesTool, requestSecret, fetchDocs]
}

const TOOL_STATUS: Record<string, string> = {
  propose_plan: "Drafting the screen plan…",
  confirm_plan: "Confirming the plan…",
  update_app: "Working out the changes…",
  set_theme: "Changing the theme…",
  setup_backend: "Setting up your backend…",
  ask_plan_questions: "Preparing planning questions…",
  propose_change_plan: "Outlining your change plan…",
  read_project_file: "Inspecting project files…",
  list_secret_names: "Checking stored API keys…",
  request_secret: "Asking for an API key…",
  fetch_docs: "Reading API documentation…",
}

function toInputItems(thread: Pick<ChatMessage, "role" | "content">[]): AgentInputItem[] {
  return thread.map((m) => {
    if (m.role === "assistant") return assistant(m.content)
    const { assets } = parseMessageContent(m.content)
    const imageAssets = assets.filter((a) => a.url && a.contentType.startsWith("image/"))
    if (imageAssets.length === 0) {
      return user(m.content)
    }
    const parts: Array<{ type: "input_text"; text: string } | { type: "input_image"; image: string }> = [
      { type: "input_text", text: m.content },
    ]
    for (const img of imageAssets) {
      if (img.url) {
        parts.push({ type: "input_image", image: img.url })
      }
    }
    return user(parts as unknown as string)
  })
}

/**
 * Answers the latest user message: understands the request, proposes or
 * revises the plan, confirms it, or changes the built app. Streams everything
 * to `run`, saves the reply, and says what should happen next.
 */
export type PlannerAsset = { fileName: string; url: string | null }

export function runPlannerTurn(
  projectRun: ProjectRun,
  project: Project,
  assets: PlannerAsset[],
  account: PlannerState["account"]
) {
  return withBuilderCall(
    { projectId: project.id, userId: project.userId, kind: "planner", label: "Planner" },
    () => planTurn(projectRun, project, assets, account)
  )
}

async function planTurn(
  projectRun: ProjectRun,
  project: Project,
  assets: PlannerAsset[],
  account: PlannerState["account"]
): Promise<{ confirmed: boolean; plan: AppPlan | null; changes: AppChanges | null }> {
  configureAgents()

  // Requests a finished build took care of are left out, so the agent can't act on them again.
  const thread = await db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(and(eq(messages.projectId, project.id), eq(messages.handled, false), eq(messages.archived, false)))
    .orderBy(messages.createdAt)

  const rows = await db
    .select({ slug: screens.slug, name: screens.name, filePath: screens.filePath, code: screens.code })
    .from(screens)
    .where(eq(screens.projectId, project.id))

  const lastUser = thread.findLast((m) => m.role === "user")
  const activeMode = lastUser ? parseMessageContent(lastUser.content).mode : "build"
  const prevMsg = thread.at(-2)
  const justAnsweredQuestions =
    prevMsg?.role === "assistant" && parseAssistantMessage(prevMsg.content).questions !== null

  const context: PlannerContext = {
    mode: activeMode,
    originalPrompt: project.prompt,
    justAnsweredQuestions,
    project,
    backend: await getBackendStatus(project.id, project.userId),
    ai: { enabled: project.aiEnabled, ...aiProvidersConfigured() },
    projectId: project.id,
    run: projectRun,
    rows,
    status: project.status,
    platform: project.platform,
    plan: project.plan,
    builtScreens: rows.filter((row) => row.code).length,
    assetNames: assets.map((a) => a.fileName),
    assets,
    account,
    proposedPlan: null,
    proposedQuestions: null,
    proposedChangePlan: null,
    confirmed: false,
    changes: null,
  }

  const turnAgent = new Agent<PlannerContext>({
    name: "AppForge Planner",
    model: PLANNER_MODEL,
    instructions: (runContext) => plannerInstructions(runContext.context),
    tools: toolsForTurn(context),
  })

  projectRun.emit({
    type: "status",
    label:
      activeMode === "chat"
        ? "Thinking about your project…"
        : activeMode === "plan" && !justAnsweredQuestions
          ? "Planning your steps…"
          : thread.length > 1
            ? "Reading your message…"
            : "Reading your request…",
  })
  const result = await run(turnAgent, toInputItems(thread), { stream: true, context })

  let text = ""
  let responseHasText = false
  const announcedTools = new Set<string>()

  for await (const event of result) {
    if (event.type === "raw_model_stream_event") {
      const data = event.data
      if (data.type === "response_started") {
        responseHasText = false
        projectRun.emit({ type: "status", label: context.confirmed ? "Starting the build…" : context.changes ? "Starting your changes…" : context.proposedPlan ? "Summarizing the plan…" : "Thinking…" })
      } else if (data.type === "output_text_delta") {
        // Text from separate model calls (before and after a tool call) becomes paragraphs.
        const delta = !responseHasText && text ? `\n\n${data.delta}` : data.delta
        if (!responseHasText) projectRun.emit({ type: "status", label: null })
        responseHasText = true
        text += delta
        projectRun.emit({ type: "text-delta", delta })
      } else if (data.type === "model") {
        // Raw Chat Completions chunks: reasoning and tool calls show up here first.
        const delta = (data.event as RawChunk)?.choices?.[0]?.delta
        if (typeof delta?.reasoning === "string" && delta.reasoning) {
          projectRun.emit({ type: "reasoning-delta", delta: delta.reasoning })
        }
        for (const call of delta?.tool_calls ?? []) {
          const name = call.function?.name
          if (name && TOOL_STATUS[name] && !announcedTools.has(name)) {
            announcedTools.add(name)
            projectRun.emit({ type: "status", label: TOOL_STATUS[name] })
          }
        }
      }
    } else if (event.type === "run_item_stream_event" && event.name === "tool_output") {
      announcedTools.clear()
    }
  }
  await result.completed

  projectRun.emit({ type: "status", label: null })
  const plainText =
    text.trim() ||
    (context.confirmed
      ? "Starting the build now."
      : context.changes
        ? "On it! I'm making those changes now."
        : context.proposedPlan
          ? "Here's the plan. Confirm it to start building, or tell me what to change."
          : context.proposedQuestions
            ? "Let's plan this step by step — pick your preferences below to shape the plan."
            : context.proposedChangePlan
              ? "Here's the change plan based on your choices. Confirm below whenever you're ready to build."
              : "Sorry, I couldn't come up with a reply. Could you say that again?")

  const content = formatAssistantMessage(plainText, {
    questions: context.proposedQuestions,
    changePlan: context.proposedChangePlan,
  })

  const [saved] = await db
    .insert(messages)
    .values({ projectId: project.id, role: "assistant", content, plan: context.proposedPlan })
    .returning({ id: messages.id, role: messages.role, content: messages.content, plan: messages.plan })
  projectRun.emit({ type: "message", message: saved })

  return { confirmed: context.confirmed, plan: context.plan, changes: context.changes }
}

type RawChunk = {
  choices?: {
    delta?: {
      reasoning?: unknown
      tool_calls?: { function?: { name?: string } }[]
    }
  }[]
}
