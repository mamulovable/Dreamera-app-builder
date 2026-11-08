// Compiles and runs the generated app's files, resolving their imports to this
// runtime's versions of each package.

import * as React from "react"
import { Fragment, jsx, jsxs } from "react/jsx-runtime"
import { transform } from "sucrase"

import type { ElementEdit, PreviewFile } from "@/lib/preview-protocol"
import { THEME_TOKENS, themeCssVariable } from "@/lib/themes"

import { AsyncStorage } from "./host"
import { elementEdit, subscribeElementEdits } from "./inspector"
import { Ionicons, LinearGradient, expoModules, reactNative, safeAreaContext, vectorIcons } from "./native"
import { expoRouter } from "./router"

/**
 * Elements that end up in the DOM. Each one is stamped with where it's written
 * in the source (`data-af-source="app/index.tsx:42:Text"`), so a click on any
 * element in the preview leads straight to the code that draws it. The compiler
 * only gives the line, so the type tells apart elements that share one.
 */
const STAMPED = new Map<unknown, string>([
  [reactNative.View, "View"],
  [reactNative.Text, "Text"],
  [reactNative.Image, "Image"],
  [reactNative.ImageBackground, "ImageBackground"],
  [reactNative.Pressable, "Pressable"],
  [reactNative.TouchableOpacity, "TouchableOpacity"],
  [reactNative.TouchableHighlight, "TouchableHighlight"],
  [reactNative.TextInput, "TextInput"],
  [reactNative.Switch, "Switch"],
  [safeAreaContext.SafeAreaView, "SafeAreaView"],
  [Ionicons, "Ionicons"],
  [LinearGradient, "LinearGradient"],
])

type JsxSource = { fileName: string; lineNumber: number }

function withEdit(props: any, edit: ElementEdit) {
  const next = { ...props, ...edit.props }
  if (edit.text !== undefined) next.children = edit.text
  if (edit.style) {
    // A Pressable's style can be a function of its pressed state.
    const style = props.style
    next.style = typeof style === "function" ? (state: unknown) => [style(state), edit.style] : [style, edit.style]
  }
  return next
}

/** Draws a stamped element, and only re-renders it when its own edit changes. */
function EditableElement({ elementType, elementProps, isStatic, source }: { elementType: React.ElementType; elementProps: any; isStatic: boolean; source: string }) {
  const edit = React.useSyncExternalStore(subscribeElementEdits, () => elementEdit(source))
  return (isStatic ? jsxs : jsx)(elementType, edit ? withEdit(elementProps, edit) : elementProps)
}

function jsxDEV(type: unknown, props: any, key: string | undefined, isStatic: boolean, location?: JsxSource) {
  const name = STAMPED.get(type)
  if (!location || !name) return (isStatic ? jsxs : jsx)(type as React.ElementType, props, key)
  const source = `${location.fileName}:${location.lineNumber}:${name}`
  const elementProps = { ...props, dataSet: { ...props.dataSet, afSource: source, afType: name } }
  return jsx(EditableElement, { elementType: type as React.ElementType, elementProps, isStatic, source }, key)
}

// The preview's version of `theme/index.ts`: tokens are CSS variables, so a theme
// switch restyles everything, even styles already made by StyleSheet.create.
const previewTheme = {
  colors: Object.fromEntries(THEME_TOKENS.map((token) => [token, `var(${themeCssVariable(token)})`])),
  statusBarStyle: "auto",
}

const asEsModule = (value: object) => ({ __esModule: true, ...value })

const PACKAGES: Record<string, unknown> = {
  react: React,
  "react/jsx-dev-runtime": { jsxDEV, Fragment },
  "react/jsx-runtime": { jsx, jsxs, Fragment },
  "react-native": reactNative,
  "expo-router": expoRouter,
  "@expo/vector-icons": vectorIcons,
  "@expo/vector-icons/Ionicons": { __esModule: true, default: Ionicons },
  "react-native-safe-area-context": safeAreaContext,
  "@react-native-async-storage/async-storage": { __esModule: true, default: AsyncStorage },
  "@/theme": previewTheme,
  ...Object.fromEntries(Object.entries(expoModules).map(([name, value]) => [name, asEsModule(value)])),
}

const EXTENSIONS = ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]

let files = new Map<string, string>()
let cache = new Map<string, { exports: Record<string, unknown> }>()

/** Replaces the app's files and forgets everything already run, including the data read from storage. */
export function setFiles(next: PreviewFile[]) {
  files = new Map(next.map((file) => [file.path, file.code]))
  resetModules()
}

export function resetModules() {
  cache = new Map()
}

/** A file's exports if the app has already run it. */
export function loadedExports(path: string) {
  return cache.get(path)?.exports
}

function resolve(specifier: string, from: string) {
  const base = specifier.startsWith("@/")
    ? specifier.slice(2)
    : new URL(specifier, `app:///${from}`).pathname.replace(/^\/+/, "")
  return EXTENSIONS.map((extension) => base + extension).find((path) => files.has(path))
}

function requireFrom(from: string, specifier: string): unknown {
  if (specifier in PACKAGES) return PACKAGES[specifier]
  const path = resolve(specifier, from)
  if (!path) throw new Error(`"${specifier}" isn't available in the preview.`)
  return loadFile(path).exports
}

export function loadFile(path: string) {
  const cached = cache.get(path)
  if (cached) return cached
  const source = files.get(path)
  if (source === undefined) throw new Error(`The file ${path} is missing.`)

  const { code } = transform(source, {
    transforms: ["typescript", "jsx", "imports"],
    jsxRuntime: "automatic",
    production: false,
    filePath: path,
  })
  const module = { exports: {} as Record<string, unknown> }
  cache.set(path, module)
  try {
    new Function("require", "module", "exports", `${code}\n//# sourceURL=app:///${path}`)(
      (specifier: string) => requireFrom(path, specifier),
      module,
      module.exports
    )
  } catch (error) {
    cache.delete(path)
    throw error
  }
  return module
}
