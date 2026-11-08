import { eq } from "drizzle-orm"

import { db, projects } from "@/db"
import { runBuildStep } from "@/lib/agent/builder"
import { BuildLostError, claimBuildStep, failBuild, finishBuild } from "@/lib/agent/builds"

/**
 * Runs every build step in this process. Used in local development, where
 * CloudHike Jobs cannot call localhost.
 */
export function startLocalBuild(buildId: string) {
  void runLocalBuild(buildId)
}

async function runLocalBuild(buildId: string) {
  let step = 1
  try {
    for (;;) {
      const claimed = await claimBuildStep(buildId, step, null)
      if (!claimed) return
      const { build, log } = claimed
      const [project] = await db.select().from(projects).where(eq(projects.id, build.projectId))
      if (!project) {
        await failBuild(buildId, "Couldn't start the build. Please try again.")
        return
      }
      const more = await runBuildStep(log, project)
      await log.flush()
      if (!more) {
        await finishBuild(buildId, log)
        return
      }
      step += 1
    }
  } catch (error) {
    if (error instanceof BuildLostError) return
    console.error(`Local build ${buildId} step ${step} failed`, error)
    await failBuild(buildId).catch((failError) => console.error(`Ending build ${buildId} failed`, failError))
  }
}
