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

let project: PreviewProject = { files: [], screens: [] }
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
  return (
    <View style={styles.phone}>
      <View style={styles.stack}>
        {stack.map((entry, i) => (
          <StackScreen key={entry.key} entry={entry} depth={stack.length - 1 - i} />
        ))}
      </View>
      <StatusBar />
      <Overlays />
      <View pointerEvents="none" style={styles.homeIndicator} />
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
  // The screen below stays drawn while the new one slides in over it. The ones
  // further down stay mounted, hidden, so they keep their state and scroll position for going back.
  return (
    <div
      className={focused && entry.animated ? "af-screen af-push" : "af-screen"}
      style={{ visibility: depth > 1 ? "hidden" : undefined }}
      inert={!focused}
    >
      {findScreen(project.screens, entry.route)?.tab ? (
        <View style={styles.tabScreen}>
          <View style={styles.tabContent}>{content}</View>
          <TabBar active={entry.route} />
        </View>
      ) : (
        content
      )}
    </div>
  )
}

/** The app's `app/(tabs)/_layout.tsx`, which the preview draws itself, like its other navigators. */
function TabBar({ active }: { active: string }) {
  return (
    <View accessibilityRole="tablist" style={styles.tabBar}>
      {project.screens.map((screen) => {
        if (!screen.tab) return null
        const selected = screen.route === active
        const color = selected ? "var(--color-primary)" : "var(--color-text-muted)"
        return (
          <Pressable
            key={screen.route}
            accessibilityRole="tab"
            aria-selected={selected}
            onPress={() => {
              if (!selected) router.replace(screen.route)
            }}
            style={styles.tab}
          >
            <Ionicons name={screen.tab.icon} size={24} color={color} />
            <Text numberOfLines={1} style={[styles.tabLabel, { color }]}>
              {screen.tab.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
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
