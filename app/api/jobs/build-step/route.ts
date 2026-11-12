import { NextResponse } from "next/server"

import { claimBuildStep, executeBuildStep } from "@/lib/agent/builds"
import { originFromRequest, verifyJobSignature } from "@/lib/jobs"

// CloudHike Free closes the run if this answer takes more than 300 seconds.
// The step itself keeps running after the answer, so this only has to claim the step.
export const maxDuration = 300

/**
 * Claims one step of a build. Called by CloudHike Jobs, not the browser.
 * The answer goes back at once. The model keeps working in this process, so a
 * slow one can think past the 300 second limit on the free plan.
 */
export async function POST(request: Request) {
  const raw = await request.text()
  if (!verifyJobSignature(raw, request.headers.get("x-cloudhike-signature"))) {
    return new NextResponse("Bad signature.", { status: 401 })
  }

  const { buildId, step } = JSON.parse(raw) as { buildId: string; step: number }
  const claimed = await claimBuildStep(buildId, step, request.headers.get("x-cloudhike-run-id"))
  if (!claimed) return NextResponse.json({ skipped: true })

  const work = executeBuildStep(claimed.build, claimed.log, step, originFromRequest(request))
  // A serverless host drops work that is still going when the answer is sent, so it waits.
  if (process.env.VERCEL) await work
  else void work.catch((error) => console.error(`Build ${buildId} step ${step} failed`, error))

  return NextResponse.json({ accepted: true })
}
