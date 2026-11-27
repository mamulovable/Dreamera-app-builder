import { Agent, assistant, run, user, type AgentInputItem } from "@openai/agents"

import { htmlPagePath, type AppPlan, type PlannedScreen } from "@/lib/agent-protocol"
import { noteBuilderCall } from "@/lib/agent/call-scope"
import { BUILDER_MODEL, configureAgents } from "@/lib/agent/config"
import { visibleCode } from "@/lib/agent/validate-screen"
import { generatedImageUrlStart, isImageKitEnabled } from "@/lib/imagekit"

const IMAGE_RULE = isImageKitEnabled()
  ? `Default photographs use <img> with a plain src of the form "${generatedImageUrlStart()}<what the picture shows>/<short-file-name>.jpg". Write the description with %20 for each space, and without commas, slashes, colons, or quote marks. Describe a real picture with no text in it. Exception: when the person uploaded a photo or pasted an https image URL to use (hero, portrait, gallery), put that exact https URL in src — never replace their photo with a new ImageKit generation URL. The home page may use up to 6 generated photos plus any user-supplied ones. Any other page may use up to 3 generated. Every image has a useful alt.`
  : `Photographs use <img src="https://picsum.photos/seed/<word>/1200/800" alt="...">, or — when the person supplied a photo/URL — that exact https URL in src. The home page may use up to 6. Any other page may use up to 3.`

const CSS_INSTRUCTIONS = `You are the AppForge site designer. You write the shared stylesheet for one premium marketing website. Reply with only the CSS. No markdown fences and no explanation.

The site is HTML, CSS, and JavaScript in a desktop browser. It must be able to look like a restaurant, a portfolio, or a product site: overlapping photos, mixed type, uneven grids, sticky header, and light motion.

# Contract
Pages will use these hooks. Define all of them.
- :root holds --bg, --surface, --text, --muted, --primary, --on-primary, --accent, --font-heading, --font-body, --radius, --shadow, --header-h.
- header.site-header is sticky, full width, and at least 72px tall on desktop. It holds .brand, nav.site-nav, and .btn. Below 840px, nav.site-nav is hidden until it has .is-open, and button.menu-button is shown.
- .btn and .btn-primary are pills. .btn-primary uses --primary and --on-primary.
- main is the page. .section is a vertical band. .wrap is centered, max-width 1120px.
- .reveal starts slightly down and faded. .reveal.is-in is in place. Transition about 0.6s.
- footer.site-footer is the closing band.
- Cards lift slightly on hover. Links and buttons have a visible focus style.
- @media (max-width: 840px) stacks rows, shrinks the hero type, and shows the menu button.

# Design
Use the plan's two fonts, colors, and the two signature techniques named in the style. Do not invent a third palette. Text must stay readable on its background. No purple glow, no generic centered template as the only idea.`

const JS_INSTRUCTIONS = `You are the AppForge site engineer. You write the shared script for one static website. Reply with only the JavaScript. No markdown fences, no imports, and no explanation.

The script runs from <script src="site.js" defer>. It must:
- Toggle nav.site-nav.is-open when button.menu-button is clicked, and close it when a nav link is clicked.
- Add .is-in to each .reveal when it enters the viewport. If IntersectionObserver is missing, add .is-in immediately.
- On submit of a form, prevent the default, show a short confirmation in an element with [data-form-status] inside that form, and leave the fields in place.
Do not use a framework, do not fetch a backend, and do not navigate with location changes other than normal links.`

const PAGE_INSTRUCTIONS = `You are the AppForge page builder. You write one complete HTML page of a premium website. Reply with only the document, starting at <!DOCTYPE html>. No markdown fences and no explanation.

The page is a real document people open in a browser. It is not React and not React Native.
- The head loads the two fonts from fonts.googleapis.com, then <link rel="stylesheet" href="styles.css">.
- The body ends with <script src="site.js" defer></script>.
- Use header.site-header, .brand, button.menu-button, nav.site-nav, main, and footer.site-footer. Top-level pages listed in the prompt belong in the nav. The current page's link has aria-current="page".
- Sections that should animate in use class="reveal".
- A unique layout for this page goes in one <style> block in the head, using the CSS variables from styles.css. Shared chrome stays in the classes from styles.css.
- At 1100px and wider the page is a desktop composition: one overlapping image, mixed type, and an uneven grid. Below 840px those rows stack. Do not draw a phone frame or a bottom tab bar.
- Write real copy for this business. Never use lorem ipsum, and never the generic template of a small centered title plus three identical cards.
- ${IMAGE_RULE}
- Links to other pages of this site use the exact filenames you are given, such as href="index.html". External links use https and rel="noreferrer".`

const cssAgent = new Agent({ name: "AppForge Site Styles", model: BUILDER_MODEL, instructions: CSS_INSTRUCTIONS })
const jsAgent = new Agent({ name: "AppForge Site Script", model: BUILDER_MODEL, instructions: JS_INSTRUCTIONS })
const pageAgent = new Agent({ name: "AppForge HTML Page", model: BUILDER_MODEL, instructions: PAGE_INSTRUCTIONS })

function planBrief(plan: AppPlan) {
  return `# Site
${plan.appName}: ${plan.tagline}
${plan.summary}
For: ${plan.targetUsers}

# Design
Style: ${plan.design.style}
Mode: ${plan.design.mode}
Primary: ${plan.design.primaryColor}
Accent: ${plan.design.accentColor}
Background: ${plan.design.backgroundColor}`
}

function pageList(plan: AppPlan) {
  return plan.screens
    .map((screen, index) => {
      const file = htmlPagePath(screen.id, index)
      const nav = screen.tab ? `, nav label "${screen.tab.label}"` : ""
      return `- ${file}: ${screen.name}. ${screen.purpose}${nav}`
    })
    .join("\n")
}

export function htmlPageProblems(code: string, plan: AppPlan) {
  const problems: string[] = []
  const lower = code.toLowerCase()
  if (!lower.includes("<!doctype html") || !lower.includes("<html") || !lower.includes("</html>")) {
    problems.push("It must be one complete HTML document, from <!DOCTYPE html> through </html>.")
  }
  if (!/href=["']styles\.css["']/.test(code)) problems.push('The head must include <link rel="stylesheet" href="styles.css">.')
  if (!/src=["']site\.js["']/.test(code)) problems.push('The body must end with <script src="site.js" defer></script>.')
  if (!lower.includes("<header") || !lower.includes("<main") || !lower.includes("<footer")) {
    problems.push("The page needs a header, a main, and a footer.")
  }
  if (/\b(react|expo|jsx)\b/i.test(code)) problems.push("This is an HTML page. Do not mention React, Expo, or JSX.")
  const files = new Set(plan.screens.map((screen, index) => htmlPagePath(screen.id, index)))
  const links = [...code.matchAll(/href=["']([^"']+\.html)["']/gi)].map((match) => match[1].split("/").pop()!)
  const unknown = [...new Set(links.filter((file) => !files.has(file) && file !== "index.html"))]
  if (unknown.length > 0) problems.push(`It links to ${unknown.join(", ")}, which is not a page of this site.`)
  return problems
}

export function cssProblems(code: string) {
  const problems: string[] = []
  if (!code.includes(":root")) problems.push("The stylesheet needs a :root block with the color and font variables.")
  if (!code.includes(".site-header") || !code.includes(".site-nav") || !code.includes(".btn-primary")) {
    problems.push("Define .site-header, .site-nav, and .btn-primary.")
  }
  if (!code.includes("@media")) problems.push("Add a max-width: 840px media query that stacks the layout.")
  if (code.includes("```")) problems.push("Reply with CSS only, without a code fence.")
  return problems
}

export function jsProblems(code: string) {
  const problems: string[] = []
  if (!code.includes("menu-button") || !code.includes("site-nav")) problems.push("The script must open nav.site-nav from button.menu-button.")
  if (!code.includes("reveal")) problems.push("The script must reveal .reveal elements.")
  if (/\b(import|require|export)\b/.test(code)) problems.push("Use plain script. No imports or exports.")
  return problems
}

async function writeFile(
  agent: Agent,
  prompt: string,
  problems: (code: string) => string[],
  signal: AbortSignal,
  onDelta?: (delta: string) => void
) {
  const generate = async (input: AgentInputItem[]) => {
    const result = await run(agent, input, { stream: true, signal })
    let raw = ""
    let shown = ""
    for await (const event of result) {
      if (event.type !== "raw_model_stream_event" || event.data.type !== "output_text_delta") continue
      raw += event.data.delta
      const next = visibleCode(raw)
      if (onDelta && next.length > shown.length && next.startsWith(shown)) {
        onDelta(next.slice(shown.length))
        shown = next
      }
    }
    await result.completed
    signal.throwIfAborted()
    return `${visibleCode(raw).trim()}\n`
  }

  configureAgents()
  const first = user(prompt)
  let code = await generate([first])
  const found = problems(code)
  if (found.length === 0) return code
  return generate([
    first,
    assistant(code),
    user(`This file has problems:\n${found.map((problem) => `- ${problem}`).join("\n")}\nRewrite the complete file with these fixed. Reply with only the file.`),
  ])
}

export function generateSiteCss(plan: AppPlan, signal: AbortSignal) {
  noteBuilderCall("page", "Styles")
  return writeFile(cssAgent, `${planBrief(plan)}\n\nWrite styles.css now.`, cssProblems, signal)
}

export function generateSiteJs(plan: AppPlan, signal: AbortSignal) {
  noteBuilderCall("page", "Script")
  return writeFile(jsAgent, `${planBrief(plan)}\n\nWrite site.js now.`, jsProblems, signal)
}

export function generateHtmlPage(
  plan: AppPlan,
  screen: PlannedScreen,
  position: number,
  edit: { code: string; request: string } | null,
  signal: AbortSignal,
  onDelta: (delta: string) => void
) {
  noteBuilderCall("page", screen.name)
  const file = htmlPagePath(screen.id, position)
  const classes = [...new Set([...(plan.site?.css ?? "").matchAll(/\.([A-Za-z][\w-]*)/g)].map((match) => match[1]))].slice(0, 60)
  const prompt = `${planBrief(plan)}

# Pages
${pageList(plan)}

# Shared classes
${classes.join(", ") || "site-header, site-nav, menu-button, btn, btn-primary, wrap, section, reveal, site-footer"}

# This page
File: ${file}
Name: ${screen.name}
Purpose: ${screen.purpose}
Key elements:
${screen.keyElements.map((element) => `- ${element}`).join("\n")}
${edit ? `\n# Current file\n${edit.code}\n\n# Requested change\n${edit.request}\n\nMake this change and keep everything else. Keep image urls already in the file unless the request asks to replace a specific image (hero, portrait, etc.) — then set that <img src> to the exact https URL named in the request (uploaded asset or pasted link). Never swap their photo for an ImageKit/picsum generation URL.\n` : ""}
Write ${file} now.`
  return writeFile(pageAgent, prompt, (code) => htmlPageProblems(code, plan), signal, onDelta)
}
