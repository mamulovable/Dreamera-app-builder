// Types shared by the publish routes (server) and the publish dialog (client).

export const APP_BUILD_PLATFORMS = ["android", "ios"] as const
export type AppBuildPlatform = (typeof APP_BUILD_PLATFORMS)[number]

export const APP_BUILD_FORMATS = ["aab", "apk", "ipa"] as const
export type AppBuildFormat = (typeof APP_BUILD_FORMATS)[number]

export const APP_BUILD_STATUSES = ["queued", "building", "ready", "failed"] as const
export type AppBuildStatus = (typeof APP_BUILD_STATUSES)[number]

export const FORMAT_PLATFORM: Record<AppBuildFormat, AppBuildPlatform> = {
  aab: "android",
  apk: "android",
  ipa: "ios",
}

/** Plain x.y.z. The App Store refuses pre-release tags in a version. */
export const VERSION_PATTERN = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/

export type AppBuildSummary = {
  id: string
  platform: AppBuildPlatform
  format: AppBuildFormat
  version: string
  status: AppBuildStatus
  easBuildId: string | null
  artifactUrl: string | null
  error: string | null
  createdAt: string
}

export type PublishStatus = {
  /** Whether this AppForge server has publishing set up. */
  available: boolean
  /** Null until the person connects. The token itself never comes back from the server. */
  expo: { account: string } | null
  /** The version of the last build, to start the form from. */
  lastVersion: string | null
  builds: AppBuildSummary[]
}

/** `expo`: the person hasn't connected Expo, or Expo no longer accepts their token. */
export type PublishErrorCode = "expo"

/** What someone needs to set up Apple credentials for this app, shown instead of starting a build. */
export type IosSetup = {
  account: string
  slug: string
  bundleIdentifier: string
}

export type PublishResult = { build: AppBuildSummary } | { iosSetup: IosSetup }

export const WEB_PUBLISH_STATUSES = ["uploading", "queued", "building", "deploying", "published", "failed"] as const
export type WebPublishStatus = (typeof WEB_PUBLISH_STATUSES)[number]

/** Where a project's website stands. There's one per project, and each publish updates it. */
export type WebPublishSummary = {
  status: WebPublishStatus
  /** The address that's online now. It stays through an update, because the last version is live until the new one replaces it. */
  url: string | null
  error: string | null
  publishedAt: string | null
}

export type ActiveWebPublishStatus = Exclude<WebPublishStatus, "published" | "failed">

export const isWebPublishActive = (status: WebPublishStatus): status is ActiveWebPublishStatus => status !== "published" && status !== "failed"

export const WEB_PUBLISH_LABELS: Record<ActiveWebPublishStatus, string> = {
  uploading: "Uploading files",
  queued: "Waiting for an Expo build server",
  building: "Building web app",
  deploying: "Deploying",
}
