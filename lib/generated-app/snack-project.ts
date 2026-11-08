// Turns a generated app into a Snack, which is how it runs in Expo Go. Screens keep calling
// `router` from "expo-router": here that's a small file on top of React Navigation, which
// runs more reliably in Snack. Nothing about the app itself changes.

import type { AppPlan, ProjectScreen, ScreenTab } from "@/lib/agent-protocol"
import { ALLOWED_PACKAGES, previewProject } from "@/lib/generated-app/project-files"

export const SNACK_SDK_VERSION = "54.0.0"

export type SnackFiles = Record<string, { type: "CODE"; contents: string }>

const ROUTER_FILE = "lib/expo-router.tsx"

/** The stack's one screen that holds the tabs, standing in for `app/(tabs)/_layout.tsx`. */
const TABS_ROUTE = "__tabs"

const IMPORT_SOURCE = /(\bfrom\s+|\bimport\s+|\brequire\(\s*)(["'])([^"']+)\2/g

// What every Snack needs, on top of the packages its code imports.
const BASE_DEPENDENCIES = [
  "@react-navigation/native",
  "@react-navigation/native-stack",
  "react-native-screens",
  "react-native-safe-area-context",
  "expo-status-bar",
  "@react-native-async-storage/async-storage",
]

// Bundled with Snack's runtime rather than installed.
const BUILT_IN = new Set(["react", "react-native", "expo-router"])

const routerCode = (tabRoutes: string[]) => `import { createNavigationContainerRef, StackActions, useNavigation as useNativeNavigation, useRoute, useFocusEffect, useIsFocused } from "@react-navigation/native";
import * as React from "react";
import { Alert, Linking, Pressable, Text } from "react-native";

export const navigationRef = createNavigationContainerRef<any>();

const tabRoutes: string[] = ${JSON.stringify(tabRoutes)};

type Href = string | { pathname: string; params?: Record<string, unknown> };

const isExternal = (href: Href) => typeof href === "string" && /^[a-z][a-z0-9+.-]*:/i.test(href);

function parse(href: Href) {
  if (typeof href !== "string") return { name: href.pathname, params: href.params ?? {} };
  const [name, query] = href.split("?");
  const params: Record<string, string> = {};
  new URLSearchParams(query ?? "").forEach((value, key) => {
    params[key] = value;
  });
  return { name, params };
}

/** Returns to the tabs on this tab, or swaps the current screen for them, as when leaving sign-in. */
function openTab(name: string, params: Record<string, unknown>) {
  const open = navigationRef.getRootState().routes.some((route: { name: string }) => route.name === ${JSON.stringify(TABS_ROUTE)});
  navigationRef.dispatch(
    open
      ? StackActions.popTo(${JSON.stringify(TABS_ROUTE)}, { screen: name, params })
      : StackActions.replace(${JSON.stringify(TABS_ROUTE)}, { screen: name, params, __replaced: true })
  );
}

/** Runs a move to a screen, or says so if that screen isn't in the app yet. */
function go(href: Href, move: (name: string, params: Record<string, unknown>) => void) {
  if (isExternal(href)) return void Linking.openURL(href as string);
  if (!navigationRef.isReady()) return;
  const { name, params } = parse(href);
  if (tabRoutes.includes(name)) return openTab(name, params);
  if (!navigationRef.getRootState()?.routeNames.includes(name)) {
    return Alert.alert("Not built yet", "This screen isn't in the app yet. You can ask the agent to add it.");
  }
  move(name, params);
}

/**
 * Older apps draw a tab bar in every screen and switch tabs with replace, so a replace can't slide or
 * each tab looks like a new page. The animation is an option of the screen, so the screen carries it.
 */
export const screenAnimation = ({ params }: { params?: any }) => (params?.__replaced ? "none" : "default");

export const router = {
  push: (href: Href) => go(href, (name, params) => navigationRef.dispatch(StackActions.push(name, params))),
  replace: (href: Href) => go(href, (name, params) => navigationRef.dispatch(StackActions.replace(name, { ...params, __replaced: true }))),
  /** Goes back to the route if it's already open, otherwise opens it. */
  navigate: (href: Href) =>
    go(href, (name, params) => {
      const open = navigationRef.getRootState().routes.some((route: { name: string }) => route.name === name);
      if (open) navigationRef.dispatch(StackActions.popTo(name, params));
      else (navigationRef.navigate as any)(name, params);
    }),
  back: () => {
    if (navigationRef.canGoBack()) navigationRef.goBack();
  },
  canGoBack: () => navigationRef.isReady() && navigationRef.canGoBack(),
  dismissAll: () => {
    if (navigationRef.canGoBack()) navigationRef.dispatch(StackActions.popToTop());
  },
  setParams: (params: Record<string, unknown>) => (navigationRef as any).setParams(params),
};

export const useRouter = () => router;

export function useLocalSearchParams<T = Record<string, string>>() {
  return (useRoute().params ?? {}) as T;
}

export const useGlobalSearchParams = useLocalSearchParams;
export const usePathname = () => useRoute().name;
export const useSegments = () => useRoute().name.split("/").filter(Boolean);
export const useNavigation = useNativeNavigation;
export { useFocusEffect, useIsFocused };

export function Link({ href, replace, asChild, children, onPress, ...props }: any) {
  const press = (event: unknown) => {
    onPress?.(event);
    if (replace) router.replace(href);
    else router.push(href);
  };
  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<any>, { onPress: press });
  }
  if (typeof children === "string") {
    return (
      <Text accessibilityRole="link" onPress={press} {...props}>
        {children}
      </Text>
    );
  }
  return (
    <Pressable accessibilityRole="link" onPress={press} {...props}>
      {children}
    </Pressable>
  );
}

export function Redirect({ href }: { href: Href }) {
  React.useEffect(() => router.replace(href), [href]);
  return null;
}

// Navigators live in App.js here, so the ones a screen draws for its options are empty.
const Navigator = Object.assign(() => null, { Screen: () => null });
export const Stack = Navigator;
export const Tabs = Navigator;
export const Slot = () => null;
`

function relativeTo(from: string, target: string) {
  const fromParts = from.split("/").slice(0, -1)
  const targetParts = target.split("/")
  while (fromParts.length > 0 && fromParts[0] === targetParts[0]) {
    fromParts.shift()
    targetParts.shift()
  }
  const path = [...fromParts.map(() => ".."), ...targetParts].join("/")
  return path.startsWith(".") ? path : `./${path}`
}

/** Snack has no path aliases, so imports point straight at each file. */
function withRelativeImports(path: string, code: string) {
  return code.replace(IMPORT_SOURCE, (match, before: string, quote: string, source: string) => {
    if (source === "expo-router") return `${before}${quote}${relativeTo(path, ROUTER_FILE.replace(/\.tsx$/, ""))}${quote}`
    if (source.startsWith("@/")) return `${before}${quote}${relativeTo(path, source.slice(2))}${quote}`
    return match
  })
}

type SnackRoute = { route: string; path: string; tab: ScreenTab | null }

function tabLayout(routes: SnackRoute[], themed: boolean) {
  const tabs = routes.flatMap(({ route, tab }, i) =>
    tab
      ? `      <Tab.Screen
        name=${JSON.stringify(route)}
        component={Screen${i}}
        options={{
          title: ${JSON.stringify(tab.label)},
          tabBarIcon: ({ color, size }) => <Ionicons name=${JSON.stringify(tab.icon)} size={size} color={color} />,
        }}
      />`
      : []
  )
  return `const Tab = createBottomTabNavigator();

function TabLayout() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,${
          themed
            ? `
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },`
            : ""
        }
      }}
    >
${tabs.join("\n")}
    </Tab.Navigator>
  );
}

`
}

function appFile(routes: SnackRoute[], themed: boolean) {
  const hasTabs = routes.some(({ tab }) => tab)
  const imports = routes.map(({ path }, i) => `import Screen${i} from "./${path.replace(/\.tsx$/, "")}";`).join("\n")
  const screens = [
    ...(hasTabs ? [`          <Stack.Screen name=${JSON.stringify(TABS_ROUTE)} component={TabLayout} />`] : []),
    ...routes.flatMap(({ route, tab }, i) => (tab ? [] : `          <Stack.Screen name=${JSON.stringify(route)} component={Screen${i}} />`)),
  ].join("\n")
  const first = routes.find(({ route }) => route === "/") ?? routes[0]
  return `${hasTabs ? `import { Ionicons } from "@expo/vector-icons";\nimport { createBottomTabNavigator } from "@react-navigation/bottom-tabs";\n` : ""}import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { navigationRef, screenAnimation } from "./lib/expo-router";
${themed ? `import { colors, statusBarStyle } from "./theme";\n` : ""}${imports}

const Stack = createNativeStackNavigator();

${hasTabs ? tabLayout(routes, themed) : ""}export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style=${themed ? "{statusBarStyle}" : `"auto"`} />
      <NavigationContainer ref={navigationRef}>
        <Stack.Navigator
          initialRouteName=${JSON.stringify(first.tab ? TABS_ROUTE : first.route)}
          screenOptions={({ route }) => ({ headerShown: false, animation: screenAnimation(route)${themed ? ", contentStyle: { backgroundColor: colors.background }" : ""} })}
        >
${screens}
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
`
}

/** The app as built so far, or null until it has a screen to open. */
export function snackProject(plan: AppPlan | null, screens: ProjectScreen[]) {
  const project = previewProject(plan, screens)
  const routes = project.screens.filter((s) => s.status === "done").map((s) => ({ route: s.route, path: s.filePath, tab: s.tab }))
  if (routes.length === 0) return null

  const sources = project.files.filter((file) => !file.path.endsWith("/_layout.tsx"))
  const tabRoutes = routes.filter(({ tab }) => tab).map(({ route }) => route)
  const files: SnackFiles = {
    "App.js": { type: "CODE", contents: appFile(routes, sources.some((file) => file.path === "theme/index.ts")) },
    [ROUTER_FILE]: { type: "CODE", contents: routerCode(tabRoutes) },
  }
  for (const file of sources) files[file.path] = { type: "CODE", contents: withRelativeImports(file.path, file.code) }

  const used = ALLOWED_PACKAGES.filter((name) => !BUILT_IN.has(name) && sources.some((file) => file.code.includes(`"${name}"`) || file.code.includes(`'${name}'`)))
  const tabDependencies = tabRoutes.length > 0 ? ["@react-navigation/bottom-tabs", "@expo/vector-icons"] : []
  const dependencies = Object.fromEntries([...new Set([...BASE_DEPENDENCIES, ...tabDependencies, ...used])].map((name) => [name, { version: "*" }]))
  return { files, dependencies }
}
