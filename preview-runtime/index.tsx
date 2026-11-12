// Runs a generated app inside the sandboxed preview frame.

import * as React from "react"
import { createRoot } from "react-dom/client"
import { Pressable, StyleSheet, Text, View } from "react-native-web"

import type { HostMessage, PreviewProject } from "@/lib/preview-protocol"

import { applyTheme, postToHost, setStorageSnapshot } from "./host"
import { clearSelection, selectParent, setEditMode, setElementEdits } from "./inspector"
import { loadFile, loadedExports, resetModules, setFiles } from "./modules"
import { INSETS, Ionicons, Overlays } from "./native"
import { ScreenContext, findScreen, resetStack, router, useStack, type StackEntry } from "./router"

let project: PreviewProject = { files: [], screens: [], shell: null, frame: "phone" }
let initialRoute = "/"
/** Bumped to run the app fresh, after its files or data changed. */
let generation = 0
let root: ReturnType<typeof createRoot> | null = null

function render() {
  root ??= createRoot(document.getElementById("root")!)
  root.render(<App key={generation} />)
}

function restart() {
  generation++
  render()
}

let storageTimer: ReturnType<typeof setTimeout> | undefined

const SYNC_MS = 5000
let syncTimer: ReturnType<typeof setInterval> | undefined

function setSyncing(syncing: boolean) {
  clearInterval(syncTimer)
  if (!syncing) return
  syncTimer = setInterval(() => {
    const backend = loadedExports("lib/backend/provider.ts")?.backend as { refresh(): void } | undefined
    backend?.refresh()
  }, SYNC_MS)
}

window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
  if (event.source !== window.parent) return
  const message = event.data
  switch (message.type) {
    case "load":
      project = message.project
      initialRoute = message.route
      document.documentElement.dataset.interactive = String(message.interactive)
      setStorageSnapshot(message.storage)
      applyTheme(message.theme)
      setElementEdits(message.edits)
      setFiles(project.files)
      resetStack(initialRoute)
      setSyncing(message.syncing)
      restart()
      break
    case "syncing":
      setSyncing(message.syncing)
      break
    case "project":
      project = message.project
      setFiles(project.files)
      restart()
      break
    case "theme":
      applyTheme(message.theme)
      break
    case "storage":
      setStorageSnapshot(message.storage)
      // Several writes often arrive together, so one refresh covers them.
      clearTimeout(storageTimer)
      storageTimer = setTimeout(() => {
        resetModules()
        restart()
      }, 150)
      break
    case "reload":
      resetModules()
      resetStack(initialRoute)
      restart()
      break
    case "edits":
      setElementEdits(message.edits)
      break
    case "edit-mode":
      setEditMode(message.enabled)
      break
    case "select-parent":
      selectParent()
      break
    case "clear-selection":
      clearSelection()
      break
  }
})

postToHost({ type: "ready" })

function App() {
  const stack = useStack()
  const browser = project.frame === "browser"
  return (
    <View style={styles.phone}>
      <View style={styles.stack}>
        {stack.map((entry, i) => (
          <StackScreen key={entry.key} entry={entry} depth={stack.length - 1 - i} />
        ))}
      </View>
      {!browser && <StatusBar />}
      <Overlays />
      {!browser && <View pointerEvents="none" style={styles.homeIndicator} />}
    </View>
  )
}

function StackScreen({ entry, depth }: { entry: StackEntry; depth: number }) {
  const focused = depth === 0
  const context = React.useMemo(
    () => ({ route: entry.route, params: entry.params, focused }),
    [entry.route, entry.params, focused]
  )
  const content = (
    <ScreenContext.Provider value={context}>
      <ScreenBoundary>
        <RouteContent route={entry.route} />
      </ScreenBoundary>
    </ScreenContext.Provider>
  )
  const shell = project.shell
  const onShellRoute = Boolean(findScreen(project.screens, entry.route)?.tab)
  // The screen below stays drawn while the new one slides in over it. The ones
  // further down stay mounted, hidden, so they keep their state and scroll position for going back.
  return (
    <div
      className={focused && entry.animated ? "af-screen af-push" : "af-screen"}
      style={{ visibility: depth > 1 ? "hidden" : undefined }}
      inert={!focused}
    >
      {onShellRoute && shell === "sidebar" ? (
        <View style={styles.sidebarScreen}>
          <ShellNav active={entry.route} kind="sidebar" />
          <View style={styles.tabContent}>{content}</View>
        </View>
      ) : onShellRoute && shell === "top-nav" ? (
        <View style={styles.tabScreen}>
          <ShellNav active={entry.route} kind="top-nav" />
          <View style={styles.tabContent}>{content}</View>
        </View>
      ) : onShellRoute ? (
        <View style={styles.tabScreen}>
          <View style={styles.tabContent}>{content}</View>
          <ShellNav active={entry.route} kind="tabs" />
        </View>
      ) : (
        content
      )}
    </div>
  )
}

/** The app's shared shell (`app/(tabs)/_layout.tsx`), which the preview draws itself. */
function ShellNav({ active, kind }: { active: string; kind: "tabs" | "top-nav" | "sidebar" }) {
  if (kind === "top-nav") return <TopNav active={active} />
  if (kind === "sidebar") return <SideNav active={active} />
  return (
    <View accessibilityRole="tablist" style={styles.tabBar}>
      {navItems().map((screen) => (
        <NavLink key={screen.route} screen={screen} active={active} kind="tabs" />
      ))}
    </View>
  )
}

function navItems() {
  return project.screens.filter((screen) => screen.tab)
}

function brandName() {
  return project.brand?.name?.trim() || navItems()[0]?.name || "Site"
}

function openRoute(route: string, selected: boolean) {
  if (!selected) router.replace(route)
}

function BrandMark({ compact = false }: { compact?: boolean }) {
  const name = brandName()
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={name} onPress={() => openRoute("/", false)} style={styles.brand}>
      <View style={styles.brandMark}>
        <Text style={styles.brandInitial}>{name.charAt(0).toUpperCase()}</Text>
      </View>
      {!compact && (
        <Text numberOfLines={1} style={styles.brandName}>
          {name}
        </Text>
      )}
    </Pressable>
  )
}

function HeaderCta() {
  const cta = project.brand?.cta
  if (!cta) return null
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.replace(cta.route)}
      style={({ pressed }: { pressed: boolean }) => [styles.headerCta, pressed && styles.headerCtaPressed]}
    >
      <Text style={styles.headerCtaText}>{cta.label}</Text>
    </Pressable>
  )
}

/** Marketing header: wordmark, text links, and a primary button. */
function TopNav({ active }: { active: string }) {
  return (
    <View accessibilityRole="tablist" style={styles.topNav}>
      <BrandMark />
      <View style={styles.topNavLinks}>
        {navItems().map((screen) => (
          <NavLink key={screen.route} screen={screen} active={active} kind="top-nav" />
        ))}
      </View>
      <HeaderCta />
    </View>
  )
}

/** Product sidebar: wordmark, links with icons, and the header button at the bottom. */
function SideNav({ active }: { active: string }) {
  return (
    <View accessibilityRole="tablist" style={styles.sidebar}>
      <View style={styles.sidebarBrand}>
        <BrandMark />
      </View>
      <View style={styles.sidebarLinks}>
        {navItems().map((screen) => (
          <NavLink key={screen.route} screen={screen} active={active} kind="sidebar" />
        ))}
      </View>
      <HeaderCta />
    </View>
  )
}

function NavLink({
  screen,
  active,
  kind,
}: {
  screen: NonNullable<ReturnType<typeof navItems>[number]>
  active: string
  kind: "tabs" | "top-nav" | "sidebar"
}) {
  const selected = screen.route === active
  const color = selected ? "var(--color-primary)" : "var(--color-text-muted)"
  const tab = screen.tab
  if (!tab) return null
  return (
    <Pressable
      accessibilityRole="tab"
      aria-selected={selected}
      onPress={() => openRoute(screen.route, selected)}
      style={[
        kind === "sidebar" ? styles.sidebarItem : kind === "top-nav" ? styles.topNavItem : styles.tab,
        kind === "top-nav" && selected && styles.topNavItemSelected,
        kind === "sidebar" && selected && styles.sidebarItemSelected,
      ]}
    >
      {kind !== "top-nav" && <Ionicons name={tab.icon} size={kind === "tabs" ? 24 : 18} color={color} />}
      <Text numberOfLines={1} style={[kind === "tabs" ? styles.tabLabel : kind === "top-nav" ? styles.topNavLabel : styles.shellLabel, { color }]}>
        {tab.label}
      </Text>
    </Pressable>
  )
}

function RouteContent({ route }: { route: string }) {
  const screen = findScreen(project.screens, route)
  if (!screen) {
    return (
      <Notice
        icon="compass-outline"
        title="This screen isn't in the app"
        body={`Nothing has been built for ${route} yet. You can ask the agent to add it.`}
      />
    )
  }
  if (screen.status === "pending" || screen.status === "generating") {
    return (
      <Notice
        icon="hammer-outline"
        title={`${screen.name} is on the way`}
        body="The agent is still building this screen. It will open here as soon as it's ready."
      />
    )
  }
  if (screen.status === "failed") {
    return (
      <Notice
        icon="alert-circle-outline"
        title={`${screen.name} couldn't be built`}
        body={`Ask the agent to try again and it will retry this screen.`}
      />
    )
  }
  const Screen = loadFile(screen.filePath).exports.default as React.ComponentType | undefined
  if (!Screen) throw new Error(`${screen.filePath} has no default export.`)
  return <Screen />
}

/** One broken screen shows a message, and the rest of the app keeps working. */
class ScreenBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    const { error } = this.state as { error: Error | null }
    if (!error) return this.props.children
    return <Notice icon="bug-outline" title="This screen hit a problem" body={error.message} />
  }
}

function Notice({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <View style={styles.notice}>
      <View style={styles.noticeIcon}>
        <Ionicons name={icon} size={28} color="var(--color-primary)" />
      </View>
      <Text style={styles.noticeTitle}>{title}</Text>
      <Text style={styles.noticeBody}>{body}</Text>
      {router.canGoBack() && (
        <Pressable
          accessibilityRole="button"
          onPress={router.back}
          style={({ pressed }: { pressed: boolean }) => [styles.noticeButton, pressed && styles.noticeButtonPressed]}
        >
          <Text style={styles.noticeButtonText}>Go back</Text>
        </Pressable>
      )}
    </View>
  )
}

function StatusBar() {
  return (
    <View pointerEvents="none" style={styles.statusBar}>
      <Text style={styles.time}>9:41</Text>
      <View style={styles.island} />
      <View style={styles.statusIcons}>
        <Ionicons name="cellular" size={16} color="var(--color-text)" />
        <Ionicons name="wifi" size={16} color="var(--color-text)" />
        <Ionicons name="battery-full" size={22} color="var(--color-text)" />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  phone: { flex: 1, overflow: "hidden", backgroundColor: "var(--color-background)" },
  stack: { flex: 1 },
  tabScreen: { flex: 1 },
  tabContent: { flex: 1 },
  tabBar: {
    flexDirection: "row",
    paddingTop: 8,
    paddingBottom: INSETS.bottom,
    borderTopWidth: 1,
    borderTopColor: "var(--color-border)",
    backgroundColor: "var(--color-surface)",
  },
  tab: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", gap: 2 },
  tabLabel: { fontSize: 11, fontWeight: "500" },
  topNav: {
    flexDirection: "row",
    alignItems: "center",
    gap: 24,
    minHeight: 72,
    paddingHorizontal: 32,
    borderBottomWidth: 1,
    borderBottomColor: "var(--color-border)",
    backgroundColor: "var(--color-surface)",
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 10, maxWidth: 280 },
  brandMark: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    backgroundColor: "var(--color-primary)",
  },
  brandInitial: { fontSize: 16, fontWeight: "700", color: "var(--color-on-primary)" },
  brandName: { flexShrink: 1, fontSize: 18, fontWeight: "700", letterSpacing: -0.3, color: "var(--color-text)" },
  topNavLinks: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4 },
  topNavItem: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 999,
  },
  topNavItemSelected: { backgroundColor: "var(--color-primary-soft)" },
  topNavLabel: { fontSize: 15, fontWeight: "600" },
  headerCta: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 40,
    paddingHorizontal: 18,
    borderRadius: 999,
    backgroundColor: "var(--color-primary)",
  },
  headerCtaPressed: { opacity: 0.85 },
  headerCtaText: { fontSize: 14, fontWeight: "700", color: "var(--color-on-primary)" },
  sidebarScreen: { flex: 1, flexDirection: "row" },
  sidebar: {
    width: 240,
    paddingTop: 20,
    paddingBottom: 20,
    paddingHorizontal: 12,
    borderRightWidth: 1,
    borderRightColor: "var(--color-border)",
    backgroundColor: "var(--color-surface)",
  },
  sidebarBrand: { paddingHorizontal: 8, paddingBottom: 20 },
  sidebarLinks: { flex: 1, gap: 4 },
  sidebarItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  sidebarItemSelected: { backgroundColor: "var(--color-primary-soft)" },
  shellLabel: { fontSize: 13, fontWeight: "600" },
  statusBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 54,
    zIndex: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 6,
    paddingHorizontal: 28,
  },
  time: { width: 64, fontSize: 16, fontWeight: "600", color: "var(--color-text)" },
  island: { width: 110, height: 30, borderRadius: 15, backgroundColor: "#000" },
  statusIcons: { width: 64, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 3 },
  homeIndicator: {
    position: "absolute",
    bottom: 8,
    left: "50%",
    marginLeft: -67,
    width: 134,
    height: 5,
    zIndex: 20,
    borderRadius: 3,
    backgroundColor: "var(--color-text)",
    opacity: 0.85,
  },
  notice: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 40, backgroundColor: "var(--color-background)" },
  noticeIcon: {
    width: 64,
    height: 64,
    marginBottom: 8,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
    backgroundColor: "var(--color-primary-soft)",
  },
  noticeTitle: { fontSize: 20, fontWeight: "700", textAlign: "center", color: "var(--color-text)" },
  noticeBody: { fontSize: 15, lineHeight: 21, textAlign: "center", color: "var(--color-text-muted)" },
  noticeButton: {
    minHeight: 44,
    marginTop: 12,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 22,
    backgroundColor: "var(--color-primary)",
  },
  noticeButtonPressed: { opacity: 0.85 },
  noticeButtonText: { fontSize: 15, fontWeight: "600", color: "var(--color-on-primary)" },
})
