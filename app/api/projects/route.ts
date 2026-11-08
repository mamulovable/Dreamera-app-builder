import { NextResponse } from "next/server"
import { desc, eq } from "drizzle-orm"

import { db, messages, projectAssets, projects } from "@/db"
import { assertCanUseAgent, assertProjectSlot, claimProjectSlot, hasProjectSlot, PlanLimitError, planLimitResponse } from "@/lib/billing/credits"
import { LAST_EDITED, SUMMARY_COLUMNS, toProjectSummary } from "@/lib/project-summaries"
import {
  isAcceptedAsset,
  isProjectPlatform,
  MAX_ASSET_SIZE,
  MAX_ASSETS,
  MAX_PROMPT_LENGTH,
  projectNameFromPrompt,
} from "@/lib/projects"
import { getCurrentUser } from "@/lib/session"
import { deleteObjects, safeFileName, uploadObject } from "@/lib/storage"

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 })
}

/** The signed-in person's own projects, most recently edited first. */
export async function GET() {
  const user = await getCurrentUser().catch(() => null)
  if (!user) return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 })

  const rows = await db
    .select({ ...SUMMARY_COLUMNS, prompt: projects.prompt })
    .from(projects)
    .where(eq(projects.userId, user.id))
    .orderBy(desc(LAST_EDITED))

  return NextResponse.json({
    projects: rows.map((row) => toProjectSummary({ ...row, tagline: row.tagline ?? row.prompt }, "owner", null)),
  })
}

/**
 * Creates a project from the composer: uploads the attached assets to storage,
 * then saves the project, its first message, and its assets in one transaction.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser().catch((error) => {
    console.error("Session lookup failed", error)
    return null
  })
  if (!user) {
    return NextResponse.json({ error: "Please sign in to create a project." }, { status: 401 })
  }

  // Before anything is uploaded.
  try {
    assertProjectSlot(await hasProjectSlot(user.id, user.plan), user.plan)
    assertCanUseAgent(user.credits)
  } catch (error) {
    if (error instanceof PlanLimitError) return planLimitResponse(error)
    throw error
  }

  const form = await request.formData().catch(() => null)
  if (!form) return badRequest("Invalid request.")

  const prompt = String(form.get("prompt") ?? "").trim()
  if (!prompt) return badRequest("Describe the app you want to build.")
  if (prompt.length > MAX_PROMPT_LENGTH) {
    return badRequest(`Keep your prompt under ${MAX_PROMPT_LENGTH} characters.`)
  }

  const platform = form.get("platform")
  if (!isProjectPlatform(platform)) return badRequest("Choose a platform.")

  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0)
  if (files.length > MAX_ASSETS) return badRequest(`You can attach up to ${MAX_ASSETS} files.`)
  for (const file of files) {
    if (file.size > MAX_ASSET_SIZE) return badRequest(`"${file.name}" is larger than 10 MB.`)
    if (!isAcceptedAsset(file.name, file.type)) {
      return badRequest(`"${file.name}" isn't a supported file type.`)
    }
  }

  const projectId = crypto.randomUUID()
  const assets = files.map((file) => ({
    file,
    storageKey: `users/${user.id}/projects/${projectId}/assets/${crypto.randomUUID()}-${safeFileName(file.name)}`,
    contentType: file.type || "application/octet-stream",
  }))

  const uploads = await Promise.allSettled(
    assets.map(async (asset) =>
      uploadObject(asset.storageKey, new Uint8Array(await asset.file.arrayBuffer()), asset.contentType)
    )
  )
  const uploadedKeys = assets
    .filter((_, i) => uploads[i].status === "fulfilled")
    .map((asset) => asset.storageKey)

  if (uploadedKeys.length < assets.length) {
    console.error(
      "Asset upload failed",
      uploads.find((u): u is PromiseRejectedResult => u.status === "rejected")?.reason
    )
    await deleteObjects(uploadedKeys).catch(() => {})
    return NextResponse.json(
      { error: "We couldn't upload your files. Please try again." },
      { status: 502 }
    )
  }

  try {
    const project = await db.transaction(async (tx) => {
      await claimProjectSlot(tx, user.id)
      const [created] = await tx
        .insert(projects)
        .values({
          id: projectId,
          userId: user.id,
          title: projectNameFromPrompt(prompt),
          prompt,
          platform,
        })
        .returning({ id: projects.id, status: projects.status })

      await tx.insert(messages).values({ projectId, role: "user", content: prompt })

      if (assets.length > 0) {
        await tx.insert(projectAssets).values(
          assets.map((asset) => ({
            projectId,
            storageKey: asset.storageKey,
            fileName: asset.file.name,
            contentType: asset.contentType,
            size: asset.file.size,
          }))
        )
      }
      return created
    })

    return NextResponse.json({ project }, { status: 201 })
  } catch (error) {
    // Don't leave orphaned files behind when the project wasn't saved.
    await deleteObjects(uploadedKeys).catch(() => {})
    if (error instanceof PlanLimitError) return planLimitResponse(error)
    console.error("Project creation failed", error)
    return NextResponse.json(
      { error: "We couldn't create your project. Please try again." },
      { status: 500 }
    )
  }
}
