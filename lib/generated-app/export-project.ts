// Turns a generated app into a complete Expo project: the files the preview runs, plus
// what `npm install` and `expo start` need. The ZIP download and GitHub push both send this.

import type { AppPlan, ProjectScreen } from "@/lib/agent-protocol"
import { isRunnable } from "@/lib/agent-protocol"
import { publishFiles } from "@/lib/generated-app/build-files"
import { ALLOWED_PACKAGES, generatedAppFiles } from "@/lib/generated-app/project-files"

export type ExportedFile = { path: string; content: string }

// From `bundledNativeModules.json` in expo@54, the same SDK the Expo Go preview runs on.
const PACKAGE_VERSIONS: Record<(typeof ALLOWED_PACKAGES)[number], string> = {
  react: "19.1.0",
  "react-native": "0.81.5",
  "expo-router": "~6.0.24",
  "@expo/vector-icons": "^15.0.3",
  "react-native-safe-area-context": "~5.6.0",
  "expo-status-bar": "~3.0.9",
  "expo-haptics": "~15.0.8",
  "expo-linear-gradient": "~15.0.8",
  "expo-image-picker": "~17.0.11",
  "expo-clipboard": "~8.0.8",
  "expo-location": "~19.0.8",
  "expo-notifications": "~0.32.17",
}

/** The packages every project needs, whichever ones its screens import. */
const ALWAYS_INCLUDED: (typeof ALLOWED_PACKAGES)[number][] = [
  "react",
  "react-native",
  "expo-router",
  "@expo/vector-icons",
  "react-native-safe-area-context",
  "expo-status-bar",
]

const BASE_DEPENDENCIES = {
  expo: "~54.0.38",
  "expo-constants": "~18.0.14",
  "expo-font": "~14.0.12",
  "expo-linking": "~8.0.12",
  "react-dom": "19.1.0",
  "react-native-screens": "~4.16.0",
  "react-native-web": "~0.21.0",
  "@react-native-async-storage/async-storage": "2.2.0",
}

const GITIGNORE = `node_modules/
.expo/
dist/
web-build/
expo-env.d.ts

# Native folders, when generated with "expo prebuild"
/ios
/android

# Signing keys
*.jks
*.p8
*.p12
*.key
*.mobileprovision

# Local environment
.env*.local

# System and debug files
.DS_Store
npm-debug.*
yarn-debug.*
yarn-error.*
`

const TSCONFIG = `${JSON.stringify(
  {
    extends: "expo/tsconfig.base",
    compilerOptions: { strict: true, paths: { "@/*": ["./*"] } },
    include: ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"],
  },
  null,
  2
)}\n`

/** A name that's safe for a package, a folder, and a repository. */
export function projectSlug(name: string) {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/, "")
  return slug || "appforge-app"
}

function packageFile(slug: string, sources: { code: string }[]) {
  const imported = ALLOWED_PACKAGES.filter(
    (name) => ALWAYS_INCLUDED.includes(name) || sources.some(({ code }) => code.includes(`"${name}"`) || code.includes(`'${name}'`))
  )
  const dependencies = { ...BASE_DEPENDENCIES, ...Object.fromEntries(imported.map((name) => [name, PACKAGE_VERSIONS[name]])) }
  return `${JSON.stringify(
    {
      name: slug,
      version: "1.0.0",
      private: true,
      main: "expo-router/entry",
      scripts: {
        start: "expo start",
        android: "expo start --android",
        ios: "expo start --ios",
        web: "expo start --web",
      },
      dependencies: Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b))),
      devDependencies: { "@types/react": "~19.1.10", typescript: "~5.9.2" },
    },
    null,
    2
  )}\n`
}

/** A store id from a name. Only letters and digits work on both stores, and it can't start with a digit. */
export function storeIdentifier(slug: string, suffix = "") {
  return `com.appforge.${slug.replace(/-/g, "").replace(/^[0-9]+/, "") || "app"}${suffix}`
}

/** A published project's identity. Once it exists it wins over anything derived from the app's current name. */
export type PublishIdentity = {
  slug: string
  androidPackage: string
  iosBundleIdentifier: string
  version: string
  easOwner: string
}

function appConfigFile(name: string, slug: string, mode: "light" | "dark" | undefined, publishing?: PublishIdentity | null) {
  const identifier = storeIdentifier(slug)
  return `${JSON.stringify(
    {
      expo: {
        name,
        slug: publishing?.slug ?? slug,
        ...(publishing ? { owner: publishing.easOwner } : {}),
        version: publishing?.version ?? "1.0.0",
        orientation: "portrait",
        scheme: slug.replace(/-/g, ""),
        userInterfaceStyle: mode ?? "automatic",
        ios: { supportsTablet: true, bundleIdentifier: publishing?.iosBundleIdentifier ?? identifier },
        android: { package: publishing?.androidPackage ?? identifier },
        web: { bundler: "metro", output: "single" },
        plugins: ["expo-router"],
      },
    },
    null,
    2
  )}\n`
}

function readmeFile(name: string, plan: AppPlan | null) {
  const backendNote = plan?.backend
    ? "The app saves its data to its CloudHike backend, set in `lib/backend/config.ts`."
    : "The app saves its data on the device. `lib/backend/` is where that can move to a cloud backend without changing any screen."
  return `# ${name}
${plan?.tagline ? `\n${plan.tagline}\n` : ""}
Built with AppForge. This is a standard [Expo](https://expo.dev) project using Expo Router.

## Run it

You need [Node.js](https://nodejs.org) 20 or newer.

\`\`\`bash
npm install
npx expo start
\`\`\`

Then scan the QR code with [Expo Go](https://expo.dev/go) on your phone, or press \`i\` for the iOS simulator, \`a\` for the Android emulator, or \`w\` for the web.

## What's inside

- \`app/\`: the screens. Each file is a route.
- \`components/\`: the UI the screens share.
- \`theme/\`: the app's colors. Change \`activeThemeId\` in \`theme/themes.ts\` to switch theme.
- \`data/\`: the data types, and the records a new install starts with.
- \`lib/backend/\`: where data, sign-in, and files are handled. ${backendNote}
`
}

/** The complete project as built so far. Screens that aren't finished yet are left out. */
export function exportedProjectFiles(
  project: { title: string; plan: AppPlan | null },
  screens: ProjectScreen[],
  publishing?: PublishIdentity | null
): ExportedFile[] {
  const name = project.plan?.appName || project.title
  const slug = projectSlug(name)
  const sources = [
    ...generatedAppFiles(project.plan),
    ...screens.filter(isRunnable).map((screen) => ({ path: screen.filePath, code: screen.code! })),
  ]
  return [
    { path: "README.md", content: readmeFile(name, project.plan) },
    { path: "package.json", content: packageFile(slug, sources) },
    { path: "app.json", content: appConfigFile(name, slug, project.plan?.design.mode, publishing) },
    { path: "tsconfig.json", content: TSCONFIG },
    { path: ".gitignore", content: GITIGNORE },
    ...(publishing ? publishFiles() : []),
    ...sources.map(({ path, code }) => ({ path, content: code })),
  ]
}
