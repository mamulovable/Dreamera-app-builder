// Expo Router's API for the preview: a stack of routes, kept in this frame.

import * as React from "react"
import { Linking, Pressable, Text } from "react-native-web"

import type { PreviewScreen } from "@/lib/preview-protocol"

export type StackEntry = {
  key: number
  route: string
  params: Record<string, string>
  animated: boolean
}

type Href = string | { pathname: string; params?: Record<string, unknown> }

let nextKey = 1
let stack: StackEntry[] = []
const listeners = new Set<() => void>()

// Nobody navigates this fast. Generated screens that redirect to each other would
// otherwise loop forever, calling the app's backend each time they open.
const MAX_NAVIGATIONS = 20
const NAVIGATION_WINDOW_MS = 2000
let navigations: number[] = []

function setStack(next: StackEntry[]) {
  const now = Date.now()
  navigations = navigations.filter((time) => now - time < NAVIGATION_WINDOW_MS)
  navigations.push(now)
  // Thrown from a screen's effect, this lands in its error boundary, which unmounts it and ends the loop.
  if (navigations.length > MAX_NAVIGATIONS) throw new Error("This screen keeps redirecting, so the preview stopped it.")
  stack = next
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useStack() {
  return React.useSyncExternalStore(subscribe, () => stack)
}

/** Parses "/detail?id=3" or { pathname, params } into a route the stack can hold. */
function toEntry(href: Href, animated: boolean): StackEntry {
  const [path, query] = (typeof href === "string" ? href : href.pathname).split("?")
  const route =
    `/${path}`
      .replace(/\/\([^/]+\)/g, "")
      .replace(/\/index$/, "/")
      .replace(/\/+/g, "/")
      .replace(/(.)\/$/, "$1") || "/"
  const params: Record<string, string> = Object.fromEntries(new URLSearchParams(query ?? ""))
  if (typeof href !== "string") {
    for (const [key, value] of Object.entries(href.params ?? {})) {
      if (value !== undefined && value !== null) params[key] = String(value)
    }
  }
  return { key: nextKey++, route, params, animated }
}

const isExternal = (href: Href) => typeof href === "string" && /^[a-z][a-z0-9+.-]*:/i.test(href)

export function resetStack(route: string) {
  navigations = []
  setStack([toEntry(route, false)])
}

export const router = {
  push(href: Href) {
    if (isExternal(href)) return void Linking.openURL(href)
    setStack([...stack, toEntry(href, true)])
  },
  replace(href: Href) {
    if (isExternal(href)) return void Linking.openURL(href)
    setStack([...stack.slice(0, -1), toEntry(href, false)])
  },
  /** Goes back to the route if it's already open, otherwise opens it. */
  navigate(href: Href) {
    if (isExternal(href)) return void Linking.openURL(href)
    const entry = toEntry(href, true)
    const existing = stack.findIndex((e) => e.route === entry.route)
    setStack(existing === -1 ? [...stack, entry] : [...stack.slice(0, existing), { ...entry, animated: false }])
  },
  back() {
    if (stack.length > 1) setStack(stack.slice(0, -1))
  },
  dismiss() {
    router.back()
  },
  dismissAll() {
    setStack(stack.slice(0, 1))
  },
  canGoBack: () => stack.length > 1,
  setParams(params: Record<string, string>) {
    const top = stack.at(-1)
    if (top) setStack([...stack.slice(0, -1), { ...top, params: { ...top.params, ...params } }])
  },
}

export const ScreenContext = React.createContext<{
  route: string
  params: Record<string, string>
  focused: boolean
}>({ route: "/", params: {}, focused: true })

function useFocusEffect(effect: () => void | (() => void)) {
  const { focused } = React.useContext(ScreenContext)
  React.useEffect(() => (focused ? effect() : undefined), [focused, effect])
}

function Link({ href, asChild, children, onPress, ...props }: any) {
  const go = (event: unknown) => {
    onPress?.(event)
    if (props.replace) router.replace(href)
    else router.push(href)
  }
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<any>, { onPress: go })
  }
  return typeof children === "string" ? (
    <Text accessibilityRole="link" onPress={go} {...props}>
      {children}
    </Text>
  ) : (
    <Pressable accessibilityRole="link" onPress={go} {...props}>
      {children}
    </Pressable>
  )
}

function Redirect({ href }: { href: Href }) {
  React.useEffect(() => router.replace(href), [href])
  return null
}

// Screens can set navigator options, but the preview has no native header to apply them to.
const Navigator = Object.assign(() => null, { Screen: () => null })

export const expoRouter = {
  router,
  useRouter: () => router,
  useLocalSearchParams: () => React.useContext(ScreenContext).params,
  useGlobalSearchParams: () => React.useContext(ScreenContext).params,
  usePathname: () => React.useContext(ScreenContext).route,
  useSegments: () => React.useContext(ScreenContext).route.split("/").filter(Boolean),
  useFocusEffect,
  useIsFocused: () => React.useContext(ScreenContext).focused,
  useNavigation: () => ({
    goBack: router.back,
    canGoBack: router.canGoBack,
    setOptions() {},
    addListener: () => () => {},
  }),
  Link,
  Redirect,
  Stack: Navigator,
  Tabs: Navigator,
  Slot: () => null,
}

export function findScreen(screens: PreviewScreen[], route: string) {
  return screens.find((screen) => screen.route === route)
}
