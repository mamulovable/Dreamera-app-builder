import { Agent, assistant, run, user, type AgentInputItem } from "@openai/agents"
import { z } from "zod"

import { COMPONENT_NAME, type AppComponent, type AppPlan } from "@/lib/agent-protocol"
import { BUILDER_MODEL } from "@/lib/agent/config"
import {
  COMPONENT_INSTRUCTIONS,
  COMPONENT_LIBRARY_INSTRUCTIONS,
  componentLibraryPrompt,
  componentPrompt,
} from "@/lib/agent/instructions"
import { componentProblems, visibleCode } from "@/lib/agent/validate-screen"

const libraryAgent = new Agent({
  name: "AppForge Component Designer",
  model: BUILDER_MODEL,
  instructions: COMPONENT_LIBRARY_INSTRUCTIONS,
})

const componentAgent = new Agent({
  name: "AppForge Component Builder",
  model: BUILDER_MODEL,
  instructions: COMPONENT_INSTRUCTIONS,
})

const librarySchema = z.object({
  components: z
    .array(z.object({ name: z.string().min(1), purpose: z.string().min(1), code: z.string().min(1) }))
    .max(16),
})

const MAX_ATTEMPTS = 2

/** The components that can be used as they are, and what's wrong with the others. */
function checkLibrary(components: AppComponent[]) {
  const accepted: AppComponent[] = []
  const problems: string[] = []
  for (const { name, purpose, code } of components) {
    const earlier = accepted.map((component) => component.name)
    if (!COMPONENT_NAME.test(name)) {
      problems.push(`The name "${name}" isn't PascalCase.`)
      continue
    }
    if (earlier.includes(name)) {
      problems.push(`There are two components named ${name}.`)
      continue
    }
    const found = componentProblems(code, name, earlier)
    if (found.length > 0) problems.push(...found.map((problem) => `${name}: ${problem}`))
    else accepted.push({ name, purpose, code: `${code.trim()}\n` })
  }
  return { accepted, problems }
}

/**
 * The shared components the screens are built from. A failure doesn't stop the
 * build: it keeps the components that came out right, which may be none, and
 * screens draw the rest themselves.
 */
export async function generateComponents(plan: AppPlan): Promise<AppComponent[]> {
  const prompt = user(componentLibraryPrompt(plan))
  let input: AgentInputItem[] = [prompt]
  let best: AppComponent[] = []
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await run(libraryAgent, input)
      const text = String(result.finalOutput ?? "")
      const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)
      const { accepted, problems } = checkLibrary(librarySchema.parse(JSON.parse(json)).components)
      if (accepted.length > best.length) best = accepted
      if (problems.length === 0) return best
      input = [
        prompt,
        assistant(text),
        user(`These have problems:\n${problems.map((problem) => `- ${problem}`).join("\n")}\nWrite the complete JSON object again with these fixed and everything else kept.`),
      ]
    } catch (error) {
      console.error(`Generating the shared components failed (attempt ${attempt})`, error)
    }
  }
  return best
}

/**
 * The new code for one shared component, or null if it didn't come out right.
 * Screens rely on it, so a broken file is never saved over a working one.
 */
export async function writeComponent(
  plan: AppPlan,
  component: Pick<AppComponent, "name" | "purpose">,
  current: string | null,
  request: string
) {
  const library = plan.components ?? []
  const position = library.findIndex((other) => other.name === component.name)
  const earlier = position < 0 ? library : library.slice(0, position)
  const prompt = user(componentPrompt({ plan, component, earlier, current, request }))

  let input: AgentInputItem[] = [prompt]
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await run(componentAgent, input)
      const code = `${visibleCode(String(result.finalOutput ?? "")).trim()}\n`
      const problems = componentProblems(code, component.name, earlier.map((other) => other.name), `${current ?? ""}\n${request}`)
      if (problems.length === 0) return code
      input = [
        prompt,
        assistant(code),
        user(`This file has problems:\n${problems.map((problem) => `- ${problem}`).join("\n")}\nRewrite the complete file with these fixed and everything else kept. Reply with only the file.`),
      ]
    } catch (error) {
      console.error(`Writing the ${component.name} component failed (attempt ${attempt})`, error)
    }
  }
  return null
}
