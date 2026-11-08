// Finds elements in a generated file and writes the person's edits into its code.
// Loaded on demand, since the parser is only needed once someone edits a screen.
//
// Edits are always applied to the code the frames are running, whose line numbers
// the elements are stamped with. Splicing the source keeps the rest of the file,
// including its formatting, exactly as it was.

import { parse } from "@babel/parser"

import type { ElementEdit, ElementEdits, ElementStyleValue } from "@/lib/preview-protocol"
import { THEME_TOKENS, themeCssVariable } from "@/lib/themes"

// Babel's node types are large and we only touch a few fields of them.
type Node = { type: string; start: number; end: number; loc: { start: { line: number } }; [key: string]: any }
type Splice = { start: number; end: number; text: string }

const TOKEN_BY_VARIABLE = new Map<string, string>(THEME_TOKENS.map((token) => [`var(${themeCssVariable(token)})`, token]))

let parsed: { code: string; ast: Node; elements: Node[] } | null = null

function parseFile(code: string) {
  if (parsed?.code === code) return parsed
  const ast = parse(code, { sourceType: "module", plugins: ["typescript", "jsx"] }) as unknown as Node
  const elements: Node[] = []
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit)
    if (!value || typeof value !== "object" || !("type" in value)) return
    const node = value as Node
    if (node.type === "JSXElement") elements.push(node)
    for (const key of Object.keys(node)) {
      if (key !== "loc" && key !== "extra" && key !== "comments" && key !== "errors" && key !== "tokens") visit(node[key])
    }
  }
  visit(ast.program)
  parsed = { code, ast, elements }
  return parsed
}

function tagName(element: Node) {
  const name = element.openingElement.name
  // <Animated.View> and <Text> are both named after their last part.
  return String(name.type === "JSXMemberExpression" ? name.property.name : name.name)
}

export function parseSource(source: string) {
  const match = source.match(/^(.+):(\d+):(\w+)$/)
  return match ? { file: match[1], line: Number(match[2]), type: match[3] } : null
}

/**
 * The element `source` stamps. Only the line and type are known, so two of the
 * same type on one line can't be told apart, and those aren't edited by hand.
 */
function findElement(code: string, source: string): Node | null {
  const location = parseSource(source)
  if (!location) return null
  const onLine = parseFile(code).elements.filter((element) => element.loc.start.line === location.line)
  const sameType = onLine.filter((element) => tagName(element) === location.type)
  if (sameType.length === 1) return sameType[0]
  // Other icon families are drawn by Ionicons, so their names differ from the type.
  return sameType.length === 0 && onLine.length === 1 ? onLine[0] : null
}

function attribute(element: Node, name: string): Node | undefined {
  return element.openingElement.attributes.find((attr: Node) => attr.type === "JSXAttribute" && attr.name.name === name)
}

/** The literal value of an attribute, or undefined if it's missing or worked out when the app runs. */
function literalAttribute(element: Node, name: string) {
  const value = attribute(element, name)?.value
  if (!value) return undefined
  if (value.type === "StringLiteral") return value.value as string
  if (value.type !== "JSXExpressionContainer") return undefined
  const expression = value.expression
  return expression.type === "StringLiteral" || expression.type === "NumericLiteral" ? (expression.value as string | number) : undefined
}

function literalImageUri(element: Node) {
  const expression = attribute(element, "source")?.value?.expression
  if (expression?.type !== "ObjectExpression") return undefined
  const uri = expression.properties.find((property: Node) => property.key?.name === "uri")
  return uri?.value?.type === "StringLiteral" ? (uri.value.value as string) : undefined
}

/** The text an element holds when it's written right there in the code. */
function literalText(element: Node) {
  const parts: string[] = []
  for (const child of element.children as Node[]) {
    if (child.type === "JSXText") parts.push(child.value)
    else if (child.type === "JSXExpressionContainer" && child.expression.type === "StringLiteral") parts.push(child.expression.value)
    else if (child.type === "JSXExpressionContainer" && child.expression.type === "JSXEmptyExpression") continue
    else return null
  }
  // JSX trims the line breaks around text, and joins its lines with a space.
  const text = parts.join("").split("\n").map((line, i, lines) => {
    let next = line.replace(/\t/g, " ")
    if (i > 0) next = next.replace(/^ +/, "")
    if (i < lines.length - 1) next = next.replace(/ +$/, "")
    return next
  }).filter(Boolean).join(" ")
  return text || null
}

export type ElementInfo = {
  /** False when the code can't be changed by hand, and only the AI can tell which element this is. */
  editable: boolean
  /** The text, if it's written in the code rather than coming from data or props. */
  text: string | null
  iconName?: string
  iconSize?: number
  imageUri?: string
  resizeMode?: string
  placeholder?: string
}

export function inspectElement(code: string, source: string): ElementInfo {
  let element: Node | null = null
  try {
    element = findElement(code, source)
  } catch {
    return { editable: false, text: null }
  }
  if (!element) return { editable: false, text: null }
  const iconSize = literalAttribute(element, "size")
  return {
    editable: true,
    text: literalText(element),
    iconName: stringOrUndefined(literalAttribute(element, "name")),
    iconSize: typeof iconSize === "number" ? iconSize : undefined,
    imageUri: literalImageUri(element),
    resizeMode: stringOrUndefined(literalAttribute(element, "resizeMode")),
    placeholder: stringOrUndefined(literalAttribute(element, "placeholder")),
  }
}

function stringOrUndefined(value: string | number | undefined) {
  return typeof value === "string" ? value : undefined
}

// ---------- Writing edits ----------

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    const token = TOKEN_BY_VARIABLE.get(value)
    return token ? `colors.${token}` : JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(formatValue).join(", ")}]`
  if (value && typeof value === "object") {
    const entries = Object.entries(value).map(([key, inner]) => `${key}: ${formatValue(inner)}`)
    return `{ ${entries.join(", ")} }`
  }
  return JSON.stringify(value)
}

const formatEntries = (entries: [string, ElementStyleValue][]) => entries.map(([key, value]) => `${key}: ${formatValue(value)}`).join(", ")

function propertyName(property: Node) {
  if (property.type !== "ObjectProperty" || property.computed) return null
  return property.key.type === "Identifier" ? property.key.name : property.key.type === "StringLiteral" ? property.key.value : null
}

/** Sets values in a style object written in the code: in place where it has them, otherwise at its end. */
function spliceObject(code: string, object: Node, entries: [string, ElementStyleValue][]): Splice[] {
  const splices: Splice[] = []
  const added: [string, ElementStyleValue][] = []
  for (const entry of entries) {
    const existing = object.properties.findLast((property: Node) => propertyName(property) === entry[0])
    if (existing?.shorthand) splices.push({ start: existing.start, end: existing.end, text: formatEntries([entry]) })
    else if (existing) splices.push({ start: existing.value.start, end: existing.value.end, text: formatValue(entry[1]) })
    else added.push(entry)
  }
  if (added.length === 0) return splices
  const last = object.properties.at(-1)
  if (!last) splices.push({ start: object.start, end: object.end, text: `{ ${formatEntries(added)} }` })
  else {
    const trailing = /^\s*,/.test(code.slice(last.end, object.end))
    const end = trailing ? last.end + code.slice(last.end, object.end).indexOf(",") + 1 : last.end
    splices.push({ start: end, end, text: `${trailing ? "" : ","} ${formatEntries(added)}${trailing ? "," : ""}` })
  }
  return splices
}

/** Adds to a style array: to the object at its end if it has one, so repeated edits don't pile up. */
function spliceArray(code: string, array: Node, entries: [string, ElementStyleValue][]): Splice[] {
  const last = array.elements.at(-1)
  if (last?.type === "ObjectExpression") return spliceObject(code, last, entries)
  const addition = `{ ${formatEntries(entries)} }`
  if (!last) return [{ start: array.start, end: array.end, text: `[${addition}]` }]
  return [{ start: last.end, end: last.end, text: `, ${addition}` }]
}

/** Keeps what the style already is, and puts the edits on top of it for this one element. */
function spliceStyleExpression(code: string, expression: Node, entries: [string, ElementStyleValue][]): Splice[] {
  if (expression.type === "ObjectExpression") return spliceObject(code, expression, entries)
  if (expression.type === "ArrayExpression") return spliceArray(code, expression, entries)
  if (expression.type === "ArrowFunctionExpression" && expression.body.type !== "BlockStatement") {
    return spliceStyleExpression(code, expression.body, entries)
  }
  const original = code.slice(expression.start, expression.end)
  const addition = `{ ${formatEntries(entries)} }`
  if (expression.type === "ArrowFunctionExpression" || expression.type === "FunctionExpression") {
    return [{ start: expression.start, end: expression.end, text: `(state) => [(${original})(state), ${addition}]` }]
  }
  return [{ start: expression.start, end: expression.end, text: `[${original}, ${addition}]` }]
}

function endOfTagName(element: Node) {
  const opening = element.openingElement
  return opening.typeArguments?.end ?? opening.typeParameters?.end ?? opening.name.end
}

function formatProp(name: string, value: unknown) {
  const formatted = formatValue(value)
  const plain = typeof value === "string" && !/["\\{}<>&\n]/.test(value) && !TOKEN_BY_VARIABLE.has(value)
  return plain ? `${name}="${value}"` : `${name}={${formatted}}`
}

function formatText(text: string) {
  const plain = !/[{}<>&\n\r]/.test(text) && text === text.trim() && !text.includes("  ")
  return plain ? text : `{${JSON.stringify(text)}}`
}

function elementSplices(code: string, element: Node, edit: ElementEdit): Splice[] {
  const splices: Splice[] = []
  const styleEntries = Object.entries(edit.style ?? {})
  if (styleEntries.length > 0) {
    const style = attribute(element, "style")
    if (style?.value?.type === "JSXExpressionContainer") {
      splices.push(...spliceStyleExpression(code, style.value.expression, styleEntries))
    } else {
      const end = endOfTagName(element)
      splices.push({ start: end, end, text: ` style={{ ${formatEntries(styleEntries)} }}` })
    }
  }
  for (const [name, value] of Object.entries(edit.props ?? {})) {
    const existing = attribute(element, name)
    if (existing) splices.push({ start: existing.start, end: existing.end, text: formatProp(name, value) })
    else {
      const end = endOfTagName(element)
      splices.push({ start: end, end, text: ` ${formatProp(name, value)}` })
    }
  }
  if (edit.text !== undefined && literalText(element) !== null) {
    const children = element.children as Node[]
    const opening = element.openingElement
    const start = children[0]?.start ?? opening.end
    splices.push({ start, end: children.at(-1)?.end ?? start, text: formatText(edit.text) })
  }
  return splices
}

/** The import a color token needs, if the file doesn't have it yet. */
function themeImportSplice(code: string, ast: Node, edits: ElementEdit[]): Splice[] {
  const usesToken = edits.some((edit) =>
    [...Object.values(edit.style ?? {}), ...Object.values(edit.props ?? {})].some((value) => typeof value === "string" && TOKEN_BY_VARIABLE.has(value))
  )
  if (!usesToken) return []
  const imports = (ast.program.body as Node[]).filter((node) => node.type === "ImportDeclaration")
  const theme = imports.find((node) => node.source.value === "@/theme")
  if (theme?.specifiers.some((specifier: Node) => specifier.local?.name === "colors")) return []
  const last = imports.at(-1)
  const position = last?.end ?? 0
  return [{ start: position, end: position, text: `${last ? "\n" : ""}import { colors } from "@/theme";${last ? "" : "\n"}` }]
}

function allSplices(code: string, edits: ElementEdits) {
  const { ast } = parseFile(code)
  const splices: Splice[] = []
  const applied: ElementEdit[] = []
  for (const [source, edit] of Object.entries(edits)) {
    const element = findElement(code, source)
    if (!element) continue
    splices.push(...elementSplices(code, element, edit))
    applied.push(edit)
  }
  splices.push(...themeImportSplice(code, ast, applied))
  return splices.sort((a, b) => a.start - b.start)
}

function applySplices(code: string, splices: Splice[]) {
  let next = ""
  let position = 0
  for (const splice of splices) {
    next += code.slice(position, splice.start) + splice.text
    position = splice.end
  }
  return next + code.slice(position)
}

/** `code` with the edits written into it. */
export function applyElementEdits(code: string, edits: ElementEdits) {
  return applySplices(code, allSplices(code, edits))
}

/** What the agent is told about the selected element: where it is now, and the code that draws it. */
export function elementInCurrentCode(base: string, edits: ElementEdits, source: string) {
  const element = findElement(base, source)
  if (!element) {
    // The line is still right unless edits moved it, and this only happens when nothing could be edited.
    return { line: parseSource(source)?.line ?? 1, snippet: "" }
  }
  const splices = allSplices(base, edits)
  const code = applySplices(base, splices)
  const shift = (offset: number, inclusive: boolean) =>
    splices.reduce((sum, splice) => {
      const before = inclusive ? splice.start <= offset : splice.start < offset
      return before ? sum + splice.text.length - (splice.end - splice.start) : sum
    }, offset)
  const start = shift(element.start, false)
  const end = shift(element.end, true)
  return { line: code.slice(0, start).split("\n").length, snippet: code.slice(start, end) }
}
