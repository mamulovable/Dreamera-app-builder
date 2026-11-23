import { NextResponse } from "next/server"
import { and, asc, eq } from "drizzle-orm"

import { db, projectAssets, projects } from "@/db"
import { isAcceptedAsset, MAX_ASSET_SIZE, MAX_ASSETS } from "@/lib/projects"
import { getCurrentUser } from "@/lib/session"
import { getObjectUrl, safeFileName, uploadObject } from "@/lib/storage"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const user = await getCurrentUser().catch(() => null)
  if (!user) return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 })
  if (!UUID_PATTERN.test(projectId)) return NextResponse.json({ error: "Project not found." }, { status: 404 })

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 })

  const rows = await db
    .select()
    .from(projectAssets)
    .where(eq(projectAssets.projectId, project.id))
    .orderBy(asc(projectAssets.createdAt))

  const assets = await Promise.all(
    rows.map(async (asset) => ({
      id: asset.id,
      fileName: asset.fileName,
      contentType: asset.contentType,
      size: asset.size,
      url: await getObjectUrl(asset.storageKey).catch(() => null),
    }))
  )

  return NextResponse.json({ assets })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const user = await getCurrentUser().catch(() => null)
  if (!user) return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 })
  if (!UUID_PATTERN.test(projectId)) return NextResponse.json({ error: "Project not found." }, { status: 404 })

  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
  if (!project) return NextResponse.json({ error: "Project not found." }, { status: 404 })

  const form = await request.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: "Invalid form data." }, { status: 400 })

  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0)
  if (files.length === 0) {
    const single = form.get("file")
    if (single instanceof File && single.size > 0) files.push(single)
  }

  if (files.length === 0) return NextResponse.json({ error: "No files provided." }, { status: 400 })
  if (files.length > MAX_ASSETS) return NextResponse.json({ error: `You can attach up to ${MAX_ASSETS} files.` }, { status: 400 })

  for (const file of files) {
    if (file.size > MAX_ASSET_SIZE) {
      return NextResponse.json({ error: `"${file.name}" is larger than 10 MB.` }, { status: 400 })
    }
    if (!isAcceptedAsset(file.name, file.type)) {
      return NextResponse.json({ error: `"${file.name}" is not a supported file type.` }, { status: 400 })
    }
  }

  const uploadedAssets: Array<{
    id: string
    fileName: string
    contentType: string
    size: number
    url: string | null
  }> = []

  for (const file of files) {
    const contentType = file.type || "application/octet-stream"
    const storageKey = `users/${user.id}/projects/${project.id}/assets/${crypto.randomUUID()}-${safeFileName(file.name)}`
    const buffer = new Uint8Array(await file.arrayBuffer())

    let url: string | null = null
    try {
      await uploadObject(storageKey, buffer, contentType)
      url = await getObjectUrl(storageKey).catch(() => null)
    } catch {
      // If storage is not configured (e.g. local dev without S3 env vars), fall back to Data URL for images
      if (contentType.startsWith("image/")) {
        const base64 = Buffer.from(buffer).toString("base64")
        url = `data:${contentType};base64,${base64}`
      }
    }

    const [row] = await db
      .insert(projectAssets)
      .values({
        projectId: project.id,
        storageKey,
        fileName: file.name,
        contentType,
        size: file.size,
      })
      .returning({ id: projectAssets.id })

    uploadedAssets.push({
      id: row?.id ?? crypto.randomUUID(),
      fileName: file.name,
      contentType,
      size: file.size,
      url,
    })
  }

  return NextResponse.json({ assets: uploadedAssets })
}
