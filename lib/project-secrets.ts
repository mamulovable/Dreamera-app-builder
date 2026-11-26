// Per-project third-party API keys. Values are sealed at rest. List/admin paths
// only ever return names. Server-only — never import from client components.

import { and, asc, eq } from "drizzle-orm"

import { db, projectSecrets } from "@/db"
import { seal, unseal } from "@/lib/cloudhike/crypto"

export const SECRET_NAME_PATTERN = /^[A-Z][A-Z0-9_]{1,63}$/
const MAX_VALUE_LENGTH = 8_192
const MAX_LABEL_LENGTH = 120

export type SecretNameRow = {
  name: string
  label: string | null
  updatedAt: Date
}

export function normalizeSecretName(value: unknown): string | null {
  if (typeof value !== "string") return null
  const name = value.trim().toUpperCase()
  return SECRET_NAME_PATTERN.test(name) ? name : null
}

export function listSecretNames(projectId: string): Promise<SecretNameRow[]> {
  return db
    .select({
      name: projectSecrets.name,
      label: projectSecrets.label,
      updatedAt: projectSecrets.updatedAt,
    })
    .from(projectSecrets)
    .where(eq(projectSecrets.projectId, projectId))
    .orderBy(asc(projectSecrets.name))
}

export async function upsertSecret(
  projectId: string,
  input: { name: string; value: string; label?: string | null }
): Promise<SecretNameRow> {
  const name = normalizeSecretName(input.name)
  if (!name) throw new SecretInputError("Use an uppercase name like OPENWEATHER_API_KEY.")

  const value = typeof input.value === "string" ? input.value.trim() : ""
  if (!value) throw new SecretInputError("Paste the API key value.")
  if (value.length > MAX_VALUE_LENGTH) throw new SecretInputError("That key is too long.")

  const label =
    typeof input.label === "string" && input.label.trim()
      ? input.label.trim().slice(0, MAX_LABEL_LENGTH)
      : null

  const sealed = seal(value)
  const [row] = await db
    .insert(projectSecrets)
    .values({ projectId, name, value: sealed, label })
    .onConflictDoUpdate({
      target: [projectSecrets.projectId, projectSecrets.name],
      set: { value: sealed, label, updatedAt: new Date() },
    })
    .returning({
      name: projectSecrets.name,
      label: projectSecrets.label,
      updatedAt: projectSecrets.updatedAt,
    })
  return row
}

export async function deleteSecret(projectId: string, nameInput: string) {
  const name = normalizeSecretName(nameInput)
  if (!name) return false
  const deleted = await db
    .delete(projectSecrets)
    .where(and(eq(projectSecrets.projectId, projectId), eq(projectSecrets.name, name)))
    .returning({ name: projectSecrets.name })
  return deleted.length > 0
}

/** Plaintext for the external proxy only. Never return this to clients or the agent. */
export async function getSecretValue(projectId: string, nameInput: string): Promise<string | null> {
  const name = normalizeSecretName(nameInput)
  if (!name) return null
  const [row] = await db
    .select({ value: projectSecrets.value })
    .from(projectSecrets)
    .where(and(eq(projectSecrets.projectId, projectId), eq(projectSecrets.name, name)))
    .limit(1)
  if (!row) return null
  try {
    return unseal(row.value)
  } catch (error) {
    console.error("Reading a project secret failed", error)
    return null
  }
}

export class SecretInputError extends Error {
  constructor(message: string) {
    super(message)
  }
}
