import { transform } from "sucrase"

import { usesComponent } from "@/lib/agent-protocol"
import { ALLOWED_COMPONENT_MODULES, ALLOWED_PACKAGES, ALLOWED_PROJECT_MODULES } from "@/lib/generated-app/project-files"

// A literal color would stay the same when the person switches theme.
const LITERAL_COLOR = /["'`]#[0-9a-f]{3,8}["'`]|\brgba?\(|\bhsla?\(|(?:color|Color)\s*:\s*["'](?:white|black)["']/gi

// Tokens are CSS variables in the preview, so they can't be combined into another color.
const TOKEN_ARITHMETIC = /\bcolors\.\w+\s*\+|\+\s*colors\.\w+|\$\{\s*colors\./

const IMPORT_SOURCE = /\bfrom\s+["']([^"']+)["']|\bimport\s+["']([^"']+)["']|\brequire\(\s*["']([^"']+)["']\s*\)/g

const COLLECTION_USE = /\buseCollection(?:<[^>]*>)?\(\s*["'`]([^"'`]+)["'`]/g

/**
 * The code as it should be shown so far: without a markdown fence around it,
 * including one that is still arriving.
 */
export function visibleCode(raw: string) {
  const text = raw.replace(/^\s*```[\w-]*\n/, "")
  if (/^\s*`{1,3}[\w-]*$/.test(text)) return ""
  return text.replace(/\n`{1,3}\s*$/, "")
}

/** Why the file can't run at all, or null if it can. */
export function fatalScreenProblem(code: string) {
  if (!code.includes("export default")) return "It has no default export."
  try {
    transform(code, { transforms: ["typescript", "jsx", "imports"], jsxRuntime: "automatic", filePath: "screen.tsx" })
    return null
  } catch (error) {
    return `It doesn't compile: ${error instanceof Error ? error.message : String(error)}.`
  }
}

function importProblem(code: string, allowedImports: string[]) {
  const unknown = [...code.matchAll(IMPORT_SOURCE)]
    .map((match) => match[1] ?? match[2] ?? match[3])
    .filter((source) => !allowedImports.includes(source))
  if (unknown.length === 0) return null
  return `It imports ${[...new Set(unknown)].join(", ")}, which isn't available. Import only from: ${allowedImports.join(", ")}.`
}

/** The first color written as a value, leaving out ones the person chose themselves. */
function literalColor(code: string, chosenByPerson: string) {
  const chosen = chosenByPerson.toLowerCase()
  return [...code.matchAll(LITERAL_COLOR)].map((match) => match[0]).find((color) => !chosen.includes(color.replace(/["'`]/g, "").toLowerCase()))
}

/**
 * What breaks the rules that screens and shared components both follow.
 * `chosenByPerson` is text whose colors stay as they are, because they asked for exactly those.
 */
function codeProblems(code: string, allowedImports: string[], chosenByPerson: string) {
  const problems: string[] = []

  const fatal = fatalScreenProblem(code)
  if (fatal) problems.push(fatal)

  const color = literalColor(code, chosenByPerson)
  if (color) {
    problems.push(`It has the literal color ${color}. Use only tokens from colors in "@/theme", such as colors.surface or colors.primarySoft.`)
  }

  if (TOKEN_ARITHMETIC.test(code)) {
    problems.push(`It builds a color by combining a token with other text. Use a token as it is, or a soft token such as colors.primarySoft for a tint.`)
  }

  if (/\bCOLORS\b/.test(code) && !problems.some((p) => p.includes("literal color"))) {
    problems.push(`It defines its own COLORS. Use colors from "@/theme" instead.`)
  }

  const imports = importProblem(code, allowedImports)
  if (imports) problems.push(imports)

  return problems
}

const componentModules = (names: string[]) => names.map((name) => `@/components/${name}`)

const screenImports = (components: string[]) => [...ALLOWED_PACKAGES, ...ALLOWED_PROJECT_MODULES, ...componentModules(components)]

const componentImports = (earlier: string[]) => [...ALLOWED_PACKAGES, ...ALLOWED_COMPONENT_MODULES, ...componentModules(earlier)]

export const screenImportProblem = (code: string, components: string[]) => importProblem(code, screenImports(components))

export const componentImportProblem = (code: string, earlier: string[]) => importProblem(code, componentImports(earlier))

/**
 * Everything in a generated screen that breaks the rules, as instructions for
 * rewriting it. A new screen has to build on the shared components, while an
 * edit leaves alone what the screen is made from.
 */
export function screenProblems(code: string, collections: string[], components: string[], isNew: boolean, chosenByPerson = "") {
  const problems: string[] = []

  // On a cloud backend each collection is a table, so one that wasn't planned has nowhere to save.
  const unplanned = [...code.matchAll(COLLECTION_USE)].map((match) => match[1]).filter((name) => !collections.includes(name))
  if (unplanned.length > 0) {
    problems.push(
      `It uses the collection ${[...new Set(unplanned)].join(", ")}, which doesn't exist. Use only: ${collections.join(", ") || "none, so use useStoredValue"}.`
    )
  }

  problems.push(...codeProblems(code, screenImports(components), chosenByPerson))

  if (isNew && components.length > 0 && !components.some((name) => usesComponent(code, name))) {
    problems.push(`It doesn't use any shared component. Build it from these wherever they fit, instead of redrawing them: ${components.join(", ")}.`)
  }

  return problems
}

/**
 * Everything in a shared component that breaks the rules. `earlier` is what it
 * may import: only the components before it, so they can never import each other in a circle.
 */
export function componentProblems(code: string, name: string, earlier: string[], chosenByPerson = "") {
  const problems = codeProblems(code, componentImports(earlier), chosenByPerson)
  if (!new RegExp(`export type ${name}Props\\s*=\\s*\\{`).test(code)) {
    problems.push(`It doesn't export its props as \`export type ${name}Props = { ... }\`, which is how screens learn to use it.`)
  }
  return problems
}
