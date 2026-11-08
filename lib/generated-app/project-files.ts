// The files every generated app gets besides its screens. They run as they are
// in both the preview and the exported Expo app, except `theme/index.ts`, which
// the preview swaps for CSS variables.

import type { AppPlan, DataCollection, ProjectScreen } from "@/lib/agent-protocol"
import { componentFilePath, hasTabLayout, isRunnable, screenRoute } from "@/lib/agent-protocol"
import type { AppBackend } from "@/lib/backend-protocol"
import type { PreviewFile, PreviewProject } from "@/lib/preview-protocol"
import type { ThemePackage } from "@/lib/themes"

/** Packages generated screens may import. The preview runtime provides each of them. */
export const ALLOWED_PACKAGES = [
  "react",
  "react-native",
  "expo-router",
  "@expo/vector-icons",
  "react-native-safe-area-context",
  "expo-status-bar",
  "expo-haptics",
  "expo-linear-gradient",
  "expo-image-picker",
  "expo-clipboard",
  "expo-location",
  "expo-notifications",
] as const

/** Project modules generated screens may import. */
export const ALLOWED_PROJECT_MODULES = ["@/theme", "@/lib/backend", "@/data/schema"] as const

/** Project modules shared components may import. Screens hand them their data, so they can't reach the backend. */
export const ALLOWED_COMPONENT_MODULES = ["@/theme", "@/data/schema"] as const

const LAYOUT_FILE = `import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { colors, statusBarStyle } from "@/theme";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style={statusBarStyle} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }} />
    </SafeAreaProvider>
  );
}
`

/** The one tab bar of the app. Its tabs come from the plan, so no screen draws or changes for it. */
function tabLayoutFile(plan: AppPlan) {
  const tabs = plan.screens.flatMap((screen, position) =>
    screen.tab
      ? `      <Tabs.Screen
        name=${JSON.stringify(position === 0 ? "index" : screen.id)}
        options={{
          title: ${JSON.stringify(screen.tab.label)},
          tabBarIcon: ({ color, size }) => <Ionicons name=${JSON.stringify(screen.tab.icon)} size={size} color={color} />,
        }}
      />`
      : []
  )
  return `import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";

import { colors } from "@/theme";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
      }}
    >
${tabs.join("\n")}
    </Tabs>
  );
}
`
}

const THEME_INDEX_FILE = `import { activeThemeId, themes } from "./themes";

const theme = themes.find((t) => t.id === activeThemeId) ?? themes[0];

/** The app's colors. Screens use these tokens and never a color value of their own. */
export const colors = theme.colors;

export const statusBarStyle = theme.mode === "dark" ? "light" : "dark";
`

function themesFile(themePackage: ThemePackage) {
  return `// Switching theme only changes activeThemeId. No screen has to change.
export const activeThemeId = ${JSON.stringify(themePackage.activeThemeId)};

export const themes = ${JSON.stringify(themePackage.themes, null, 2)};
`
}

function schemaFile(collections: DataCollection[]) {
  const types = collections.map(
    (collection) =>
      `export type ${collection.typeName} = Document & {\n${collection.fields
        .map((field) => `  ${field.name}: ${field.type};`)
        .join("\n")}\n};`
  )
  return [`import type { Document } from "@/lib/backend";`, ...types].join("\n\n") + "\n"
}

function seedFile(collections: DataCollection[]) {
  const seed = Object.fromEntries(collections.map((c) => [c.name, c.items]))
  return `// The records a new install starts with on the local provider. On CloudHike, only shared collections get them.
export const seedData: Record<string, ({ id: string } & Record<string, unknown>)[]> = ${JSON.stringify(seed, null, 2)};
`
}

const BACKEND_TYPES_FILE = `// The contract between the app and its backend. Screens and hooks only know this,
// so moving from local storage to CloudHike doesn't change them.

export type Document = {
  id: string;
  createdAt?: string;
  updatedAt?: string;
};

export type NewDocument<T extends Document> = Omit<T, "id" | "createdAt" | "updatedAt">;

export interface Collection<T extends Document> {
  /** What's known right now without waiting, so screens can draw straight away. */
  peek(): T[];
  list(): Promise<T[]>;
  get(id: string): Promise<T | null>;
  insert(values: NewDocument<T>): Promise<T>;
  update(id: string, changes: Partial<NewDocument<T>>): Promise<T | null>;
  remove(id: string): Promise<void>;
  subscribe(listener: (items: T[]) => void): () => void;
}

export interface KeyValueStore {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

export type StoredFile = { url: string; name: string };

export interface FileStorage {
  /** Takes a local file uri, such as one from the image picker. */
  upload(uri: string, name?: string): Promise<StoredFile>;
  remove(url: string): Promise<void>;
}

export type AuthUser = { id: string; email: string; name: string };

export interface Auth {
  getUser(): Promise<AuthUser | null>;
  signIn(email: string, password: string): Promise<AuthUser>;
  signUp(email: string, password: string, name: string): Promise<AuthUser>;
  signOut(): Promise<void>;
  subscribe(listener: (user: AuthUser | null) => void): () => void;
}

export interface Mailer {
  /** Emails the signed-in person, and nobody else. */
  sendToMe(subject: string, text: string): Promise<void>;
}

export interface BackendProvider {
  collection<T extends Document>(name: string): Collection<T>;
  keyValue: KeyValueStore;
  storage: FileStorage;
  auth: Auth;
  email: Mailer;
  /** Loads the collections on screen again, for changes made somewhere else. */
  refresh(): void;
}
`

function backendConfigFile(backend: AppBackend | null | undefined) {
  const config = backend
    ? {
        provider: "cloudhike",
        apiUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}${backend.apiPath}`,
        authUrl: backend.authUrl,
        authKey: backend.authKey,
      }
    : { provider: "local" }
  return `export type BackendConfig =
  | { provider: "local" }
  | { provider: "cloudhike"; apiUrl: string; authUrl: string | null; authKey: string | null };

// Connecting a CloudHike account only changes this file. None of these values are secret.
export const backendConfig: BackendConfig = ${JSON.stringify(config, null, 2)};
`
}

const BACKEND_LOCAL_FILE = `import AsyncStorage from "@react-native-async-storage/async-storage";

import { seedData } from "@/data/seed";

import type { Auth, AuthUser, BackendProvider, Collection, Document, FileStorage, KeyValueStore, NewDocument } from "./types";

const COLLECTION_PREFIX = "app:collection:";
const VALUE_PREFIX = "app:value:";
const USER_KEY = "app:auth:user";

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function createCollection<T extends Document>(name: string): Collection<T> {
  const key = COLLECTION_PREFIX + name;
  const listeners = new Set<(items: T[]) => void>();
  let items = (seedData[name] ?? []) as T[];
  let loaded = false;

  async function load() {
    if (!loaded) {
      const stored = await AsyncStorage.getItem(key);
      if (stored) items = JSON.parse(stored) as T[];
      loaded = true;
    }
    return items;
  }

  async function save(next: T[]) {
    items = next;
    loaded = true;
    await AsyncStorage.setItem(key, JSON.stringify(next));
    listeners.forEach((listener) => listener(next));
  }

  return {
    peek: () => items,
    list: load,
    async get(id) {
      return (await load()).find((item) => item.id === id) ?? null;
    },
    async insert(values: NewDocument<T>) {
      const now = new Date().toISOString();
      const item = { ...values, id: newId(), createdAt: now, updatedAt: now } as unknown as T;
      await save([item, ...(await load())]);
      return item;
    },
    async update(id, changes) {
      const current = await load();
      const existing = current.find((item) => item.id === id);
      if (!existing) return null;
      const updated = { ...existing, ...changes, updatedAt: new Date().toISOString() };
      await save(current.map((item) => (item.id === id ? updated : item)));
      return updated;
    },
    async remove(id) {
      await save((await load()).filter((item) => item.id !== id));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const keyValue: KeyValueStore = {
  async get<T>(key: string) {
    const stored = await AsyncStorage.getItem(VALUE_PREFIX + key);
    return stored === null ? null : (JSON.parse(stored) as T);
  },
  async set(key, value) {
    await AsyncStorage.setItem(VALUE_PREFIX + key, JSON.stringify(value));
  },
  async remove(key) {
    await AsyncStorage.removeItem(VALUE_PREFIX + key);
  },
};

// Files stay where they are on the device, so the uri itself is the stored file.
const storage: FileStorage = {
  async upload(uri, name) {
    return { url: uri, name: name ?? uri.split("/").pop()?.slice(0, 80) ?? "file" };
  },
  async remove() {},
};

function createAuth(): Auth {
  const listeners = new Set<(user: AuthUser | null) => void>();

  async function setUser(user: AuthUser | null) {
    if (user) await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
    else await AsyncStorage.removeItem(USER_KEY);
    listeners.forEach((listener) => listener(user));
    return user;
  }

  // Local accounts are stand-ins: the device has nothing to check a password
  // against, so passwords are ignored and never stored.
  const account = (email: string, name?: string): AuthUser => ({
    id: email.trim().toLowerCase(),
    email: email.trim(),
    name: name?.trim() || email.split("@")[0],
  });

  return {
    async getUser() {
      const stored = await AsyncStorage.getItem(USER_KEY);
      return stored ? (JSON.parse(stored) as AuthUser) : null;
    },
    async signIn(email) {
      return (await setUser(account(email))) as AuthUser;
    },
    async signUp(email, _password, name) {
      return (await setUser(account(email, name))) as AuthUser;
    },
    async signOut() {
      await setUser(null);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function createLocalProvider(): BackendProvider {
  const collections = new Map<string, Collection<any>>();
  return {
    collection<T extends Document>(name: string) {
      if (!collections.has(name)) collections.set(name, createCollection<T>(name));
      return collections.get(name) as Collection<T>;
    },
    keyValue,
    storage,
    auth: createAuth(),
    email: {
      async sendToMe() {
        throw new Error("Sending email needs the CloudHike backend.");
      },
    },
    // Only this device changes local data, and it tells the screens itself.
    refresh() {},
  };
}
`

const BACKEND_CLOUDHIKE_FILE = `import AsyncStorage from "@react-native-async-storage/async-storage";

import type { Auth, AuthUser, BackendProvider, Collection, Document, FileStorage, KeyValueStore, Mailer, NewDocument } from "./types";

type CloudHikeConfig = { apiUrl: string; authUrl: string | null; authKey: string | null };

const DEVICE_KEY = "app:backend:device";
const TOKEN_KEY = "app:auth:token";
const USER_KEY = "app:auth:user";

export function createCloudHikeProvider(config: CloudHikeConfig): BackendProvider {
  const refreshers = new Set<() => void>();
  const onScreen = new Set<() => void>();
  const authListeners = new Set<(user: AuthUser | null) => void>();

  let deviceRequest: Promise<string> | null = null;
  function deviceId() {
    deviceRequest ??= (async () => {
      const stored = await AsyncStorage.getItem(DEVICE_KEY);
      if (stored) return stored;
      const response = await fetch(config.apiUrl + "/devices", { method: "POST" });
      if (!response.ok) throw new Error("Couldn't reach the app's backend.");
      const { deviceId: created } = await response.json();
      await AsyncStorage.setItem(DEVICE_KEY, created);
      return created as string;
    })().catch((error) => {
      deviceRequest = null;
      throw error;
    });
    return deviceRequest;
  }

  async function setSession(token: string | null, user: AuthUser | null) {
    if (token && user) {
      await AsyncStorage.setItem(TOKEN_KEY, token);
      await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
    } else {
      await AsyncStorage.removeItem(TOKEN_KEY);
      await AsyncStorage.removeItem(USER_KEY);
    }
    authListeners.forEach((listener) => listener(user));
    // Records belong to whoever is signed in, so every list changes with them.
    refreshers.forEach((refresh) => refresh());
  }

  async function request<R>(path: string, init: { method?: string; body?: unknown } = {}): Promise<R> {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    const response = await fetch(config.apiUrl + path, {
      method: init.method ?? "GET",
      headers: {
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        ...(token ? { authorization: "Bearer " + token } : { "x-device-id": await deviceId() }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (response.status === 401 && token) {
      await setSession(null, null);
      return request<R>(path, init);
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(data?.message ?? "Couldn't reach the app's backend.") as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    return data as R;
  }

  function createCollection<T extends Document>(name: string): Collection<T> {
    const path = "/collections/" + encodeURIComponent(name);
    const listeners = new Set<(items: T[]) => void>();
    let items: T[] = [];
    let latest = "[]";

    function show(next: T[]) {
      const text = JSON.stringify(next);
      if (text === latest) return;
      latest = text;
      items = next;
      listeners.forEach((listener) => listener(next));
    }

    async function load() {
      const data = await request<{ items: T[] }>(path);
      show(data.items);
      return items;
    }

    // Offline or asleep: screens keep what they have, and the next load catches up.
    const refresh = () => {
      load().catch(() => {});
    };
    refreshers.add(refresh);

    return {
      peek: () => items,
      list: () => load().catch(() => items),
      async get(id) {
        const known = items.find((item) => item.id === id);
        if (known) return known;
        return request<T>(path + "/" + encodeURIComponent(id)).catch(() => null);
      },
      async insert(values: NewDocument<T>) {
        const item = await request<T>(path, { method: "POST", body: values });
        show([item, ...items]);
        return item;
      },
      async update(id, changes) {
        const updated = await request<T>(path + "/" + encodeURIComponent(id), { method: "PATCH", body: changes }).catch((error) => {
          if (error.status === 404) return null;
          throw error;
        });
        if (updated) show(items.map((item) => (item.id === id ? updated : item)));
        return updated;
      },
      async remove(id) {
        await request(path + "/" + encodeURIComponent(id), { method: "DELETE" });
        show(items.filter((item) => item.id !== id));
      },
      subscribe(listener) {
        listeners.add(listener);
        onScreen.add(refresh);
        return () => {
          listeners.delete(listener);
          if (listeners.size === 0) onScreen.delete(refresh);
        };
      },
    };
  }

  const collections = new Map<string, Collection<any>>();

  const keyValue: KeyValueStore = {
    async get<V>(key: string) {
      const { value } = await request<{ value: V | null }>("/values/" + encodeURIComponent(key));
      return value;
    },
    async set(key, value) {
      await request("/values/" + encodeURIComponent(key), { method: "PUT", body: { value } });
    },
    async remove(key) {
      await request("/values/" + encodeURIComponent(key), { method: "DELETE" });
    },
  };

  const storage: FileStorage = {
    async upload(uri, name) {
      const file = await (await fetch(uri)).blob();
      const target = await request<{ uploadUrl: string; contentType: string; url: string; name: string }>("/files", {
        method: "POST",
        body: { name: name ?? uri.split("/").pop()?.slice(0, 80) ?? "file", contentType: file.type },
      });
      const uploaded = await fetch(target.uploadUrl, { method: "PUT", headers: { "content-type": target.contentType }, body: file });
      if (!uploaded.ok) throw new Error("Couldn't upload the file.");
      return { url: target.url, name: target.name };
    },
    async remove(url) {
      await request("/files", { method: "DELETE", body: { url } });
    },
  };

  async function authRequest(path: string, init: { method?: string; body?: unknown; token?: string } = {}) {
    if (!config.authUrl || !config.authKey) throw new Error("Sign-in isn't set up for this app yet.");
    const response = await fetch(config.authUrl + path, {
      method: init.method ?? "GET",
      headers: {
        "content-type": "application/json",
        "x-api-key": config.authKey,
        ...(init.token ? { authorization: "Bearer " + init.token } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.message ?? "Couldn't sign in. Please try again.");
    return data;
  }

  const toUser = (user: { id: string; email: string; name?: string }): AuthUser => ({
    id: user.id,
    email: user.email,
    name: user.name || user.email.split("@")[0],
  });

  const auth: Auth = {
    async getUser() {
      const stored = await AsyncStorage.getItem(USER_KEY);
      return stored ? (JSON.parse(stored) as AuthUser) : null;
    },
    async signIn(email, password) {
      const { token, user } = await authRequest("/sign-in/email", { method: "POST", body: { email: email.trim(), password } });
      await setSession(token, toUser(user));
      return toUser(user);
    },
    async signUp(email, password, name) {
      const { token, user } = await authRequest("/sign-up/email", { method: "POST", body: { name: name.trim(), email: email.trim(), password } });
      await setSession(token, toUser(user));
      return toUser(user);
    },
    async signOut() {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      if (token) await authRequest("/sign-out", { method: "POST", body: {}, token }).catch(() => {});
      await setSession(null, null);
    },
    subscribe(listener) {
      authListeners.add(listener);
      return () => {
        authListeners.delete(listener);
      };
    },
  };

  const email: Mailer = {
    async sendToMe(subject, text) {
      await request("/email", { method: "POST", body: { subject, text } });
    },
  };

  return {
    collection<T extends Document>(name: string) {
      if (!collections.has(name)) collections.set(name, createCollection<T>(name));
      return collections.get(name) as Collection<T>;
    },
    keyValue,
    storage,
    auth,
    email,
    refresh() {
      onScreen.forEach((refresh) => refresh());
    },
  };
}
`

const BACKEND_PROVIDER_FILE = `import { createCloudHikeProvider } from "./cloudhike";
import { backendConfig } from "./config";
import { createLocalProvider } from "./local";

export const backend =
  backendConfig.provider === "cloudhike" ? createCloudHikeProvider(backendConfig) : createLocalProvider();
`

const BACKEND_HOOKS_FILE = `import { useCallback, useEffect, useState } from "react";

import { backend } from "./provider";
import type { AuthUser, Document, NewDocument } from "./types";

/** A live list of a collection's records, with functions to change them. */
export function useCollection<T extends Document>(name: string) {
  const collection = backend.collection<T>(name);
  const [items, setItems] = useState<T[]>(() => collection.peek());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    collection.list().then((loaded) => {
      if (!active) return;
      setItems(loaded);
      setLoading(false);
    });
    const unsubscribe = collection.subscribe(setItems);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [collection]);

  const add = useCallback((values: NewDocument<T>) => collection.insert(values), [collection]);
  const update = useCallback((id: string, changes: Partial<NewDocument<T>>) => collection.update(id, changes), [collection]);
  const remove = useCallback((id: string) => collection.remove(id), [collection]);

  return { items, loading, add, update, remove };
}

/** A single saved value such as a setting, used like useState. */
export function useStoredValue<T>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(initialValue);

  useEffect(() => {
    let active = true;
    backend.keyValue
      .get<T>(key)
      .then((stored) => {
        if (active && stored !== null) setValue(stored);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [key]);

  const save = useCallback(
    (next: T) => {
      setValue(next);
      return backend.keyValue.set(key, next);
    },
    [key]
  );

  return [value, save] as const;
}

// Undefined until the session has been read. Screens often redirect on \`user\` as soon as
// they open, so one opening later must not see a signed-in person as signed out for a moment.
let knownUser: AuthUser | null | undefined;
backend.auth.subscribe((user) => {
  knownUser = user;
});

/** The signed-in person, with functions to sign in and out. */
export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(knownUser ?? null);
  const [loading, setLoading] = useState(knownUser === undefined);

  useEffect(() => {
    let active = true;
    backend.auth.getUser().then((current) => {
      knownUser = current;
      if (!active) return;
      setUser(current);
      setLoading(false);
    });
    const unsubscribe = backend.auth.subscribe(setUser);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return {
    user,
    loading,
    signIn: backend.auth.signIn,
    signUp: backend.auth.signUp,
    signOut: backend.auth.signOut,
  };
}

/** Saves a local file, such as a picked photo, and returns its url. */
export function uploadFile(uri: string, name?: string) {
  return backend.storage.upload(uri, name);
}

/** Emails the signed-in person. Only works on the CloudHike backend, with email deployed. */
export function sendEmailToMe(subject: string, text: string) {
  return backend.email.sendToMe(subject, text);
}
`

const BACKEND_INDEX_FILE = `export { backend } from "./provider";
export { sendEmailToMe, uploadFile, useAuth, useCollection, useStoredValue } from "./hooks";
export type * from "./types";
`

/** The shared files for a plan. Plans built before themes existed have none of the themed ones. */
export function generatedAppFiles(plan: AppPlan | null): PreviewFile[] {
  if (!plan?.themePackage || !plan.collections) return []
  return [
    { path: "app/_layout.tsx", code: LAYOUT_FILE },
    ...(hasTabLayout(plan) ? [{ path: "app/(tabs)/_layout.tsx", code: tabLayoutFile(plan) }] : []),
    { path: "theme/index.ts", code: THEME_INDEX_FILE },
    { path: "theme/themes.ts", code: themesFile(plan.themePackage) },
    { path: "data/schema.ts", code: schemaFile(plan.collections) },
    { path: "data/seed.ts", code: seedFile(plan.collections) },
    { path: "lib/backend/index.ts", code: BACKEND_INDEX_FILE },
    { path: "lib/backend/types.ts", code: BACKEND_TYPES_FILE },
    { path: "lib/backend/config.ts", code: backendConfigFile(plan.backend) },
    { path: "lib/backend/provider.ts", code: BACKEND_PROVIDER_FILE },
    { path: "lib/backend/hooks.ts", code: BACKEND_HOOKS_FILE },
    { path: "lib/backend/local.ts", code: BACKEND_LOCAL_FILE },
    { path: "lib/backend/cloudhike.ts", code: BACKEND_CLOUDHIKE_FILE },
    ...(plan.components ?? []).map((component) => ({ path: componentFilePath(component.name), code: component.code })),
  ]
}

/** What the preview runtime needs to run the app as built so far. */
export function previewProject(plan: AppPlan | null, screens: ProjectScreen[]): PreviewProject {
  return {
    files: [
      ...generatedAppFiles(plan),
      ...screens.filter(isRunnable).map((s) => ({ path: s.filePath, code: s.code! })),
    ],
    screens: screens.map((s) => ({
      route: screenRoute(s.slug, s.position),
      name: s.name,
      status: isRunnable(s) ? "done" : s.status,
      filePath: s.filePath,
      tab: plan?.screens.find((planned) => planned.id === s.slug)?.tab ?? null,
    })),
  }
}
