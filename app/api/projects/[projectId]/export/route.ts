import { NextResponse } from "next/server"
import { strToU8, zipSync } from "fflate"

import { ExportUnavailableError, getProjectAccess, loadProjectExport } from "@/lib/project-access"
import { getCurrentUser } from "@/lib/session"

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

/** Downloads the complete Expo project as a ZIP. Everyone the project is shared with can do this. */
export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const user = await getCurrentUser().catch(() => null)
  if (!user) return error("Please sign in to continue.", 401)

  try {
    const access = await getProjectAccess(projectId, user.id)
    if (!access) return error("Project not found.", 404)

    const { slug, files } = await loadProjectExport(access.project)
    const archive = zipSync(Object.fromEntries(files.map((file) => [`${slug}/${file.path}`, strToU8(file.content)])))
    return new NextResponse(Buffer.from(archive), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${slug}.zip"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (cause) {
    if (cause instanceof ExportUnavailableError) return error(cause.message, 409)
    console.error("Exporting a project failed", cause)
    return error("We couldn't package your project. Please try again.", 500)
  }
}
