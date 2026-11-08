// Types shared by the CloudHike integration (server) and the workspace (client).
// Nothing in here is secret: credentials never leave `lib/cloudhike/`.

export const BACKEND_SERVICES = ["postgres", "auth", "storage", "redis", "jobs", "email"] as const
export type BackendService = (typeof BACKEND_SERVICES)[number]

export const BACKEND_SERVICE_LABELS: Record<BackendService, string> = {
  postgres: "Database",
  auth: "Authentication",
  storage: "File storage",
  redis: "Redis",
  jobs: "Background jobs",
  email: "Email",
}

export const BACKEND_STATES = ["linked", "provisioning", "ready", "failed", "disconnected"] as const
export type BackendState = (typeof BACKEND_STATES)[number]

export type BackendServiceStatus = { type: BackendService; status: string }

/** What the workspace shows about a project's backend. */
export type BackendStatus = {
  /** Whether this AppForge deployment has its CloudHike app credentials. */
  available: boolean
  /** Whether the person's CloudHike account is connected. */
  accountConnected: boolean
  /** "disconnected" when this app doesn't use CloudHike. */
  state: BackendState
  services: BackendServiceStatus[]
  dashboardUrl: string | null
  error: string | null
}

/** What a generated app needs to reach its backend. Safe to ship inside the app. */
export type AppBackend = {
  /** The app's data API, on this site. */
  apiPath: string
  /** CloudHike Auth, which is meant to be called from apps. */
  authUrl: string | null
  authKey: string | null
  services: BackendService[]
}

export const BACKEND_CONNECT_RESULTS = ["connected", "denied", "error"] as const
export type BackendConnectResult = (typeof BACKEND_CONNECT_RESULTS)[number]

/** Whether the app counts as connected, which is what the workspace tells the person. */
export function isBackendConnected({ accountConnected, state }: BackendStatus) {
  return state === "ready" || (accountConnected && state !== "disconnected")
}
