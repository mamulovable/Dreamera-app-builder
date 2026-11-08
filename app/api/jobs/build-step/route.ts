import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"

import { db, projects } from "@/db"
import { runBuildStep } from "@/lib/agent/builder"
import { BuildLostError, claimBuildStep, finishBuild, queueNextStep } from "@/lib/agent/builds"
import { verifyJobSignature } from "@/lib/jobs"

// Jobs decides when a step has run too long; this only has to outlast its longest timeout on the plan in use.
export const maxDuration = 800

/**
 * Runs one step of a build. Called by CloudHike Jobs, not the browser. An error
 * answer makes Jobs retry the step, and any other answer ends the run.
 */
export async function POST(request: Request) {
  const raw = await request.text()
  if (!verifyJobSignature(raw, request.headers.get("x-cloudhike-signature"))) {
    return new NextResponse("Bad signature.", { status: 401 })
  }

  const { buildId, step } = JSON.parse(raw) as { buildId: string; step: number }
  const claimed = await claimBuildStep(buildId, step, request.headers.get("x-cloudhike-run-id"))
  if (!claimed) return NextResponse.json({ skipped: true })
  const { build, log } = claimed

  try {
    const [project] = await db.select().from(projects).where(eq(projects.id, build.projectId))
    const more = await runBuildStep(log, project)
    await log.flush()
    if (more) await queueNextStep(buildId, step)
    else await finishBuild(buildId, log)
    return NextResponse.json({ more })
  } catch (error) {
    if (log.signal.aborted || error instanceof BuildLostError) return NextResponse.json({ superseded: true })
    console.error(`Build ${buildId} step ${step} failed`, error)
    return NextResponse.json({ error: "The build step failed." }, { status: 500 })
  }
}
