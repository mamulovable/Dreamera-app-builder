import { NextResponse } from "next/server"
import { and, eq } from "drizzle-orm"

import { db, projects } from "@/db"
import {
  deleteSecret,
  listSecretNames,
  SecretInputError,
  upsertSecret,
} from "@/lib/project-secrets"
import { getCurrentUser } from "@/lib/session"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

async function ownedProject(projectId: string) {
  const user = await getCurrentUser().catch(() => null)
  if (!user) return { failure: error("Please sign in to continue.", 401) }
  if (!UUID_PATTERN.test(projectId)) return { failure: error("Project not found.", 404) }
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
  if (!project) return { failure: error("Project not found.", 404) }
  return { project, user }
}

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { failure, project } = await ownedProject((await params).projectId)
  if (failure) return failure
  const secrets = await listSecretNames(project.id)
  return NextResponse.json({
    secrets: secrets.map((secret) => ({
      name: secret.name,
      label: secret.label,
      updatedAt: secret.updatedAt.toISOString(),
    })),
  })
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { failure, project } = await ownedProject((await params).projectId)
  if (failure) return failure

  const body = (await request.json().catch(() => null)) as {
    name?: unknown
    value?: unknown
    label?: unknown
  } | null
  if (!body || typeof body.name !== "string" || typeof body.value !== "string") {
    return error("Send the key name and value.", 400)
  }

  try {
    const secret = await upsertSecret(project.id, {
      name: body.name,
      value: body.value,
      label: typeof body.label === "string" ? body.label : null,
    })
    return NextResponse.json({
      secret: {
        name: secret.name,
        label: secret.label,
        updatedAt: secret.updatedAt.toISOString(),
      },
    })
  } catch (cause) {
    if (cause instanceof SecretInputError) return error(cause.message, 400)
    console.error("Saving a project secret failed", cause)
    return error("Couldn't save that API key. Please try again.", 500)
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { failure, project } = await ownedProject((await params).projectId)
  if (failure) return failure

  const body = (await request.json().catch(() => null)) as { name?: unknown } | null
  if (!body || typeof body.name !== "string") return error("Send the key name to remove.", 400)

  const removed = await deleteSecret(project.id, body.name)
  if (!removed) return error("That API key wasn't found.", 404)
  return NextResponse.json({ ok: true })
}
