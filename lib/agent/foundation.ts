import { Agent, run } from "@openai/agents"
import { z } from "zod"

import { DATA_FIELD_TYPES, type AppPlan, type DataCollection } from "@/lib/agent-protocol"
import { BUILDER_MODEL } from "@/lib/agent/config"
import { DATA_CHANGE_INSTRUCTIONS, FOUNDATION_INSTRUCTIONS, dataChangePrompt, foundationPrompt } from "@/lib/agent/instructions"
import {
  BASE_THEME_TOKENS,
  HEX_COLOR,
  completeTheme,
  fallbackThemePackage,
  themeFromDesign,
  type BaseThemeToken,
  type ThemePackage,
} from "@/lib/themes"

const foundationAgent = new Agent({
  name: "AppForge Foundation Designer",
  model: BUILDER_MODEL,
  instructions: FOUNDATION_INSTRUCTIONS,
})

const dataChangeAgent = new Agent({
  name: "AppForge Data Designer",
  model: BUILDER_MODEL,
  instructions: DATA_CHANGE_INSTRUCTIONS,
})

const foundationSchema = z.object({
  themes: z
    .array(
      z.object({
        name: z.string().min(1),
        mode: z.enum(["light", "dark"]),
        colors: z.object(
          Object.fromEntries(BASE_THEME_TOKENS.map((token) => [token, z.string().regex(HEX_COLOR)])) as Record<
            BaseThemeToken,
            z.ZodString
          >
        ),
      })
    )
    .min(2)
    .max(8),
  collections: z
    .array(
      z.object({
        name: z.string().min(1),
        typeName: z.string().min(1),
        fields: z.array(
          z.object({ name: z.string().min(1), type: z.enum(DATA_FIELD_TYPES), references: z.string().nullable().optional() })
        ),
        items: z.array(z.record(z.string(), z.unknown())),
        shared: z.boolean().optional(),
      })
    )
    .max(8),
})

const MAX_ATTEMPTS = 2
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/
const RESERVED_FIELDS = new Set(["id", "createdAt", "updatedAt"])

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "theme"
}

function toThemePackage(plan: AppPlan, themes: z.infer<typeof foundationSchema>["themes"]): ThemePackage {
  // The first theme is the design the person confirmed, so its main colors are kept exactly.
  const planned = themeFromDesign(plan.design)
  const used = new Set<string>([planned.id])
  const others = themes.slice(1).map((theme) => {
    let id = slug(theme.name)
    for (let n = 2; used.has(id); n++) id = `${slug(theme.name)}-${n}`
    used.add(id)
    return completeTheme({ ...theme, id })
  })
  const first = completeTheme({
    id: planned.id,
    name: themes[0].name,
    mode: plan.design.mode,
    colors: {
      ...themes[0].colors,
      primary: plan.design.primaryColor,
      accent: plan.design.accentColor,
      background: plan.design.backgroundColor,
    },
  })
  return { activeThemeId: first.id, themes: [first, ...others] }
}

function toCollections(collections: z.infer<typeof foundationSchema>["collections"], known: string[] = []): DataCollection[] {
  const usable = collections.filter((c) => IDENTIFIER.test(c.name) && IDENTIFIER.test(c.typeName))
  const names = new Set([...known, ...usable.map((c) => c.name)])
  return usable.map((collection) => ({
    name: collection.name,
    typeName: collection.typeName,
    fields: collection.fields
      .filter((field) => IDENTIFIER.test(field.name) && !RESERVED_FIELDS.has(field.name))
      .map(({ name, type, references }) => ({
        name,
        type,
        references: type === "string" && references && names.has(references) ? references : null,
      })),
    items: collection.items.map((item, i) => ({ ...item, id: String(item.id ?? `${collection.name}-${i + 1}`) })),
    shared: collection.shared === true,
  }))
}

/**
 * Each field is a column once an app is on its backend, and built screens rely on
 * them, so what a field was stays as it was, and one left out of a change is kept.
 */
function keepExistingFields(next: DataCollection, current: DataCollection | undefined): DataCollection {
  if (!current) return next
  const added = next.fields.filter((field) => !current.fields.some((c) => c.name === field.name))
  return {
    ...next,
    fields: [
      ...current.fields.map((field) => ({
        ...field,
        references: field.references ?? next.fields.find((n) => n.name === field.name && n.type === field.type)?.references ?? null,
      })),
      ...added,
    ],
  }
}

/**
 * The parts every screen is built on: the theme package and the app's data with
 * its sample records. A failure here doesn't stop the build. It falls back to
 * themes worked out from the plan's colors, and screens start with no records.
 */
export async function generateFoundation(plan: AppPlan) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await run(foundationAgent, foundationPrompt(plan))
      const text = String(result.finalOutput ?? "")
      const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)
      const foundation = foundationSchema.parse(JSON.parse(json))
      return {
        themePackage: toThemePackage(plan, foundation.themes),
        collections: toCollections(foundation.collections),
      }
    } catch (error) {
      console.error(`Generating the app foundation failed (attempt ${attempt})`, error)
    }
  }
  return { themePackage: fallbackThemePackage(plan.design), collections: [] }
}

/**
 * The app's collections after `change`. Built screens rely on the current ones,
 * so none are dropped. A failure doesn't stop the build: they stay as they are,
 * and new screens are built on those.
 */
export async function changeCollections(plan: AppPlan, change: string): Promise<DataCollection[]> {
  const current = plan.collections ?? []
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await run(dataChangeAgent, dataChangePrompt(plan, change))
      const text = String(result.finalOutput ?? "")
      const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)
      const { collections } = foundationSchema.pick({ collections: true }).parse(JSON.parse(json))
      const next = toCollections(collections, current.map((c) => c.name)).map((collection) =>
        keepExistingFields(collection, current.find((c) => c.name === collection.name))
      )
      return [...next, ...current.filter((c) => !next.some((n) => n.name === c.name))]
    } catch (error) {
      console.error(`Changing the app's data failed (attempt ${attempt})`, error)
    }
  }
  return current
}
