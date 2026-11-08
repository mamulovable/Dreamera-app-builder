// The native parts of a phone that a browser doesn't have: alerts, share sheets,
// safe areas, icons, photo picking, and so on. Same API as on a device.

import * as React from "react"
import * as ReactNative from "react-native-web"
import ionicons from "virtual:ionicons"

const { Pressable, StyleSheet, Text, View } = ReactNative

export const INSETS = { top: 54, bottom: 34, left: 0, right: 0 }

// ---------- Alerts and banners ----------

type AlertButton = { text?: string; style?: "default" | "cancel" | "destructive"; onPress?: () => void }
type Overlay =
  | { kind: "alert"; title: string; message?: string; buttons: AlertButton[]; cancelable?: boolean }
  | { kind: "banner"; title: string; message?: string }
  | null

let alertState: Overlay = null
let bannerState: Overlay = null
let bannerTimer: ReturnType<typeof setTimeout> | undefined
const overlayListeners = new Set<() => void>()
const notifyOverlays = () => overlayListeners.forEach((listener) => listener())

function subscribeOverlays(listener: () => void) {
  overlayListeners.add(listener)
  return () => {
    overlayListeners.delete(listener)
  }
}

function showBanner(title: string, message?: string) {
  bannerState = { kind: "banner", title, message }
  notifyOverlays()
  clearTimeout(bannerTimer)
  bannerTimer = setTimeout(() => {
    bannerState = null
    notifyOverlays()
  }, 3200)
}

export const Alert = {
  alert(title: string, message?: string, buttons?: AlertButton[], options?: { cancelable?: boolean }) {
    alertState = { kind: "alert", title, message, buttons: buttons?.length ? buttons : [{ text: "OK" }], cancelable: options?.cancelable }
    notifyOverlays()
  },
}

function closeAlert(button?: AlertButton) {
  alertState = null
  notifyOverlays()
  button?.onPress?.()
}

export function Overlays() {
  const alert = React.useSyncExternalStore(subscribeOverlays, () => alertState)
  const banner = React.useSyncExternalStore(subscribeOverlays, () => bannerState)
  return (
    <>
      {banner?.kind === "banner" && (
        <View accessibilityRole="alert" style={overlayStyles.banner}>
          <Text style={overlayStyles.bannerTitle} numberOfLines={1}>
            {banner.title}
          </Text>
          {banner.message ? (
            <Text style={overlayStyles.bannerMessage} numberOfLines={2}>
              {banner.message}
            </Text>
          ) : null}
        </View>
      )}
      {alert?.kind === "alert" && (
        <View style={overlayStyles.backdrop}>
          <View accessibilityRole="alert" style={overlayStyles.alert}>
            <View style={overlayStyles.alertBody}>
              <Text style={overlayStyles.alertTitle}>{alert.title}</Text>
              {alert.message ? <Text style={overlayStyles.alertMessage}>{alert.message}</Text> : null}
            </View>
            <View style={alert.buttons.length === 2 ? overlayStyles.buttonRow : undefined}>
              {alert.buttons.map((button, i) => (
                <Pressable
                  key={i}
                  accessibilityRole="button"
                  onPress={() => closeAlert(button)}
                  style={({ pressed }: { pressed: boolean }) => [
                    overlayStyles.alertButton,
                    alert.buttons.length === 2 && overlayStyles.buttonInRow,
                    pressed && overlayStyles.alertButtonPressed,
                  ]}
                >
                  <Text
                    style={[
                      overlayStyles.alertButtonText,
                      button.style === "cancel" && overlayStyles.cancelText,
                      button.style === "destructive" && overlayStyles.destructiveText,
                    ]}
                  >
                    {button.text ?? "OK"}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      )}
    </>
  )
}

const overlayStyles = StyleSheet.create({
  banner: {
    position: "absolute",
    top: INSETS.top,
    left: 12,
    right: 12,
    zIndex: 40,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: "var(--color-surface)",
    borderWidth: 1,
    borderColor: "var(--color-border)",
    shadowColor: "var(--color-shadow)",
    shadowOpacity: 0.2,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
  },
  bannerTitle: { fontSize: 14, fontWeight: "600", color: "var(--color-text)" },
  bannerMessage: { marginTop: 2, fontSize: 13, color: "var(--color-text-muted)" },
  backdrop: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 30,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "var(--color-overlay)",
  },
  alert: { width: 280, overflow: "hidden", borderRadius: 18, backgroundColor: "var(--color-surface)" },
  alertBody: { alignItems: "center", gap: 4, paddingHorizontal: 20, paddingVertical: 18 },
  alertTitle: { fontSize: 17, fontWeight: "600", textAlign: "center", color: "var(--color-text)" },
  alertMessage: { fontSize: 13, lineHeight: 18, textAlign: "center", color: "var(--color-text-muted)" },
  buttonRow: { flexDirection: "row" },
  buttonInRow: { flex: 1 },
  alertButton: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderTopWidth: 1,
    borderLeftWidth: 0,
    borderColor: "var(--color-border)",
  },
  alertButtonPressed: { backgroundColor: "var(--color-surface-alt)" },
  alertButtonText: { fontSize: 16, fontWeight: "600", color: "var(--color-primary)" },
  cancelText: { fontWeight: "400" },
  destructiveText: { color: "var(--color-danger)" },
})

// ---------- react-native overrides ----------

const Share = {
  sharedAction: "sharedAction",
  dismissedAction: "dismissedAction",
  async share(content: { title?: string; message?: string; url?: string }) {
    showBanner("Share sheet", content.message ?? content.url ?? content.title ?? "On a phone, this opens the share sheet.")
    return { action: "sharedAction" }
  },
}

const Linking = {
  async openURL(url: string) {
    // The preview can't place calls or open mail, so it says what would happen.
    if (/^https?:/i.test(url)) window.open(url, "_blank", "noopener")
    else showBanner("Opening link", url)
  },
  canOpenURL: async () => true,
  getInitialURL: async () => null,
  openSettings: async () => showBanner("Settings", "On a phone, this opens the app's settings."),
  addEventListener: () => ({ remove() {} }),
}

const Platform = {
  OS: "ios",
  Version: "18.0",
  isPad: false,
  isTV: false,
  select: (options: Record<string, unknown>) => options.ios ?? options.native ?? options.default,
}

export const reactNative = { ...ReactNative, Alert, Share, Linking, Platform }

// ---------- Safe area ----------

function SafeAreaView({ edges, style, ...props }: any) {
  const flat = StyleSheet.flatten(style) ?? {}
  const sides: string[] = edges ?? ["top", "bottom"]
  const pad = (side: "top" | "bottom", key: string) =>
    sides.includes(side)
      ? { [key]: (flat[key] ?? flat.paddingVertical ?? flat.padding ?? 0) + INSETS[side] }
      : null
  return <View {...props} style={[style, pad("top", "paddingTop"), pad("bottom", "paddingBottom")]} />
}

export const safeAreaContext = {
  SafeAreaView,
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSafeAreaInsets: () => INSETS,
  useSafeAreaFrame: () => ({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }),
  initialWindowMetrics: null,
}

// ---------- Icons ----------

const ICON_FALLBACK = '<circle cx="256" cy="256" r="160" fill="none" stroke="currentColor" stroke-width="32"/>'

function iconMarkup(name: string) {
  return ionicons[name] ?? ionicons[name.replace(/-sharp$/, "")] ?? ICON_FALLBACK
}

export function Ionicons({ name, size = 24, color, style, ...props }: any) {
  const flatColor = color ?? StyleSheet.flatten(style)?.color ?? "var(--color-text)"
  return (
    <View {...props} style={[{ width: size, height: size }, style]}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 512 512"
        width={size}
        height={size}
        fill="currentColor"
        aria-hidden
        style={{ display: "block", color: flatColor }}
        dangerouslySetInnerHTML={{ __html: iconMarkup(String(name)) }}
      />
    </View>
  )
}

export const vectorIcons = {
  __esModule: true,
  Ionicons,
  // Older screens may use another family. Unknown names draw a neutral circle.
  MaterialIcons: Ionicons,
  MaterialCommunityIcons: Ionicons,
  Feather: Ionicons,
  FontAwesome: Ionicons,
  FontAwesome5: Ionicons,
  AntDesign: Ionicons,
  Entypo: Ionicons,
}

// ---------- Expo modules ----------

export function LinearGradient({ colors, locations, start, end, style, ...props }: any) {
  const from = start ?? { x: 0.5, y: 0 }
  const to = end ?? { x: 0.5, y: 1 }
  const angle = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI + 90
  const stops = (colors as string[]).map((color, i) => (locations?.[i] != null ? `${color} ${locations[i] * 100}%` : color))
  return <View {...props} style={[{ backgroundImage: `linear-gradient(${angle}deg, ${stops.join(", ")})` }, style]} />
}

const granted = async () => ({ status: "granted", granted: true, canAskAgain: true, expires: "never" })

/** A picked photo, scaled down so it fits in the app's saved data. */
function pickImage(capture: boolean) {
  return new Promise<unknown>((resolve) => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = "image/*"
    if (capture) input.capture = "environment"
    input.oncancel = () => resolve({ canceled: true, assets: null })
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return resolve({ canceled: true, assets: null })
      const url = URL.createObjectURL(file)
      const image = new Image()
      image.onload = () => {
        const scale = Math.min(1, 800 / Math.max(image.width, image.height))
        const canvas = document.createElement("canvas")
        canvas.width = Math.round(image.width * scale)
        canvas.height = Math.round(image.height * scale)
        canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height)
        URL.revokeObjectURL(url)
        resolve({
          canceled: false,
          assets: [
            {
              uri: canvas.toDataURL("image/jpeg", 0.8),
              width: canvas.width,
              height: canvas.height,
              type: "image",
              fileName: file.name,
              mimeType: "image/jpeg",
            },
          ],
        })
      }
      image.onerror = () => resolve({ canceled: true, assets: null })
      image.src = url
    }
    input.click()
  })
}

const SAMPLE_COORDS = {
  latitude: 37.7749,
  longitude: -122.4194,
  altitude: 16,
  accuracy: 5,
  altitudeAccuracy: 5,
  heading: 0,
  speed: 0,
}

let clipboard = ""

export const expoModules: Record<string, Record<string, unknown>> = {
  "expo-status-bar": { StatusBar: () => null, setStatusBarStyle() {}, setStatusBarHidden() {} },
  "expo-linear-gradient": { LinearGradient },
  "expo-haptics": {
    impactAsync: async () => {},
    notificationAsync: async () => {},
    selectionAsync: async () => {},
    ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy", Soft: "soft", Rigid: "rigid" },
    NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
  },
  "expo-image-picker": {
    requestMediaLibraryPermissionsAsync: granted,
    getMediaLibraryPermissionsAsync: granted,
    requestCameraPermissionsAsync: granted,
    getCameraPermissionsAsync: granted,
    launchImageLibraryAsync: () => pickImage(false),
    launchCameraAsync: () => pickImage(true),
    MediaTypeOptions: { All: "All", Images: "Images", Videos: "Videos" },
  },
  "expo-clipboard": {
    setStringAsync: async (text: string) => {
      clipboard = text
      return true
    },
    getStringAsync: async () => clipboard,
    hasStringAsync: async () => clipboard.length > 0,
  },
  "expo-location": {
    requestForegroundPermissionsAsync: granted,
    getForegroundPermissionsAsync: granted,
    requestBackgroundPermissionsAsync: granted,
    hasServicesEnabledAsync: async () => true,
    getCurrentPositionAsync: async () => ({ coords: SAMPLE_COORDS, timestamp: Date.now() }),
    getLastKnownPositionAsync: async () => ({ coords: SAMPLE_COORDS, timestamp: Date.now() }),
    watchPositionAsync: async (_options: unknown, callback: (location: unknown) => void) => {
      callback({ coords: SAMPLE_COORDS, timestamp: Date.now() })
      return { remove() {} }
    },
    reverseGeocodeAsync: async () => [
      { city: "San Francisco", region: "California", country: "United States", street: "Market St", postalCode: "94103", name: "Market St" },
    ],
    Accuracy: { Lowest: 1, Low: 2, Balanced: 3, High: 4, Highest: 5, BestForNavigation: 6 },
  },
  "expo-notifications": {
    setNotificationHandler() {},
    requestPermissionsAsync: granted,
    getPermissionsAsync: granted,
    getExpoPushTokenAsync: async () => ({ data: "preview-token", type: "expo" }),
    async scheduleNotificationAsync({ content, trigger }: { content: { title?: string; body?: string }; trigger?: { seconds?: number } | null }) {
      // Shown soon, whatever the delay, so it can be seen in the preview.
      const delay = Math.min(trigger?.seconds ?? 0, 3) * 1000
      setTimeout(() => showBanner(content.title ?? "Notification", content.body), delay)
      return String(Date.now())
    },
    cancelScheduledNotificationAsync: async () => {},
    cancelAllScheduledNotificationsAsync: async () => {},
    addNotificationReceivedListener: () => ({ remove() {} }),
    addNotificationResponseReceivedListener: () => ({ remove() {} }),
    SchedulableTriggerInputTypes: { TIME_INTERVAL: "timeInterval", DATE: "date", DAILY: "daily", WEEKLY: "weekly" },
  },
}
