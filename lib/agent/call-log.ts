import { builderCalls, db, projects, users } from "@/db"
import { builderCallScope, type BuilderCallKind } from "@/lib/agent/call-scope"
import { eq } from "drizzle-orm"

type TokenDetails = { [key: string]: number | TokenDetails }

export type BuilderUsage = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  inputTokensDetails?: TokenDetails | TokenDetails[]
}

function whole(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

function cachedTokens(details: TokenDetails | TokenDetails[] | undefined) {
  const list = Array.isArray(details) ? details : details ? [details] : []
  return list.reduce((sum, item) => sum + whole(item.cached_tokens), 0)
}

/** Writes one builder model call. A logging failure must not fail the build. */
export async function recordBuilderCall(entry: {
  provider: string
  model: string
  role: "planner" | "builder"
  usage: BuilderUsage | null
  status: "succeeded" | "failed"
  error?: string | null
  durationMs: number
}) {
  try {
    const scope = builderCallScope()
    const inputTokens = whole(entry.usage?.inputTokens)
    const outputTokens = whole(entry.usage?.outputTokens)
    const cachedInputTokens = Math.min(inputTokens, cachedTokens(entry.usage?.inputTokensDetails))
    const totalTokens = whole(entry.usage?.totalTokens) || inputTokens + outputTokens
    let userId = scope?.userId ?? null
    let projectId = scope?.projectId ?? null
    let userEmail = "—"
    let projectTitle = "—"
    if (scope) {
      const [owner] = await db
        .select({ userId: projects.userId, title: projects.title, email: users.email })
        .from(projects)
        .innerJoin(users, eq(users.id, projects.userId))
        .where(eq(projects.id, scope.projectId))
      if (owner) {
        userId = owner.userId
        projectTitle = owner.title
        userEmail = owner.email
      }
    }
    const kind: BuilderCallKind = scope?.kind ?? (entry.role === "planner" ? "planner" : "build")
    await db.insert(builderCalls).values({
      userId,
      projectId,
      userEmail,
      projectTitle,
      kind,
      label: scope?.label ?? (entry.role === "planner" ? "Planner" : "Builder"),
      provider: entry.provider,
      model: entry.model,
      status: entry.status,
      inputTokens,
      cachedInputTokens,
      outputTokens,
      totalTokens,
      error: entry.error ? entry.error.slice(0, 300) : null,
      durationMs: entry.durationMs,
    })
  } catch (error) {
    console.error("Couldn't record the builder call", error)
  }
}
