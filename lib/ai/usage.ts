import { and, eq, gte, sql } from "drizzle-orm"

import { creditTransactions, db } from "@/db"
import { AiProviderError } from "@/lib/ai/providers"
import { AI_DAILY_CREDIT_CAP } from "@/lib/plans"

/** How many AI credits this app has spent since 00:00 UTC. Refunds are a different reason, so a failed call doesn't count twice. */
export async function aiSpentToday(projectId: string) {
  const start = new Date()
  start.setUTCHours(0, 0, 0, 0)
  const [row] = await db
    .select({ spent: sql<number>`coalesce(sum(-${creditTransactions.amount}), 0)::int` })
    .from(creditTransactions)
    .where(and(eq(creditTransactions.projectId, projectId), eq(creditTransactions.reason, "ai"), gte(creditTransactions.createdAt, start)))
  return Number(row?.spent ?? 0)
}

export async function assertAiBudget(projectId: string, cost: number) {
  const spent = await aiSpentToday(projectId)
  if (spent + cost > AI_DAILY_CREDIT_CAP) {
    throw new AiProviderError("This app has used its AI for today. Try again tomorrow.", 429)
  }
}
