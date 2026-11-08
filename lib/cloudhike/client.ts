// Server-only client for a person's CloudHike workspace (https://cloudhike.dev/docs/connect).
// Never import this from client components.

import { MCPServerStreamableHttp } from "@openai/agents"

import { BACKEND_SERVICES, type BackendService, type BackendServiceStatus } from "@/lib/backend-protocol"

export const CLOUDHIKE_URL = (process.env.CLOUDHIKE_URL || "https://cloudhike.dev").replace(/\/$/, "")

export const CLOUDHIKE_CALLBACK_PATH = "/api/cloudhike/callback"

/** The token is wrong or the person disconnected AppForge in CloudHike, so they have to connect again. */
export class CloudHikeAuthError extends Error {
  constructor() {
    super("CloudHike no longer accepts this connection. Connect your account again.")
  }
}

/** Something CloudHike said no to, such as a plan limit, in words the person can act on. */
export class CloudHikeError extends Error {}

export function isCloudHikeAvailable() {
  return Boolean(process.env.CLOUDHIKE_CLIENT_ID && process.env.CLOUDHIKE_CLIENT_SECRET && process.env.CLOUDHIKE_ENCRYPTION_KEY)
}

export function cloudhikeCallbackUrl(fallbackOrigin: string) {
  return new URL(CLOUDHIKE_CALLBACK_PATH, process.env.NEXT_PUBLIC_APP_URL || fallbackOrigin).toString()
}

export function cloudhikeConnectUrl(redirectUri: string, state: string) {
  const url = new URL("/connect", CLOUDHIKE_URL)
  url.searchParams.set("client_id", process.env.CLOUDHIKE_CLIENT_ID ?? "")
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("state", state)
  return url
}

export function cloudhikeDashboardUrl(slug: string | null) {
  return slug ? `${CLOUDHIKE_URL}/dashboard/projects/${encodeURIComponent(slug)}` : null
}

export type CloudHikeGrant = { accessToken: string; mcpUrl: string; apiUrl: string }

/** Trades the code from the callback for an access token. The client secret never leaves this server. */
export async function exchangeCloudHikeCode(code: string, redirectUri: string): Promise<CloudHikeGrant> {
  const response = await fetch(`${CLOUDHIKE_URL}/api/connect/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code,
      redirect_uri: redirectUri,
      client_id: process.env.CLOUDHIKE_CLIENT_ID,
      client_secret: process.env.CLOUDHIKE_CLIENT_SECRET,
    }),
    cache: "no-store",
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data?.access_token) {
    throw new Error(`CloudHike token exchange failed: ${response.status} ${data?.error ?? ""}`)
  }
  return {
    accessToken: data.access_token,
    mcpUrl: data.mcp_url ?? `${CLOUDHIKE_URL}/api/mcp`,
    apiUrl: data.api_url ?? `${CLOUDHIKE_URL}/api/v1`,
  }
}

export type CloudHikeProject = { id: string; name: string; slug: string | null }

function toProject(value: { id: string; name?: string; slug?: string | null }): CloudHikeProject {
  return { id: value.id, name: value.name ?? "", slug: value.slug ?? null }
}

/** The services a project reports, in either of the shapes it could list them. */
function toServices(raw: unknown): BackendServiceStatus[] {
  const entries: [string | undefined, unknown][] = Array.isArray(raw)
    ? raw.map((service) => [service?.type ?? service?.name ?? service?.service, service])
    : Object.entries((raw ?? {}) as Record<string, unknown>)
  const services: BackendServiceStatus[] = []
  for (const [type, value] of entries) {
    if (!BACKEND_SERVICES.includes(type as BackendService)) continue
    const status = typeof value === "string" ? value : (value as { status?: unknown } | null)?.status
    services.push({ type: type as BackendService, status: String(status ?? "unknown").toLowerCase() })
  }
  return services
}

/** Each service comes back as queued, exists, or error with a message, such as a billing or plan limit. */
function deployRefusal(answer: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(answer)
  } catch {
    return null
  }
  const visit = (value: unknown): string | null => {
    if (!value || typeof value !== "object") return null
    const { status, message, error } = value as Record<string, unknown>
    if (status === "error") return String(message ?? error ?? "CloudHike couldn't deploy a service.")
    for (const child of Object.values(value)) {
      const found = visit(child)
      if (found) return found
    }
    return null
  }
  return visit(parsed)
}

/** Parses a .env file. Quotes around a value are removed. */
export function parseEnvFile(text: string) {
  const env: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!match) continue
    const quoted = match[2].match(/^(["'])(.*)\1$/)
    env[match[1]] = quoted ? quoted[2] : match[2]
  }
  return env
}

/**
 * Acts in one person's workspace. Changes go through CloudHike MCP. Reading a
 * project's status and .env uses the REST API, because its response formats are
 * documented, and so those secrets never pass through a tool an agent can see.
 */
export class CloudHikeClient {
  constructor(private grant: CloudHikeGrant) {}

  private get headers() {
    return { authorization: `Bearer ${this.grant.accessToken}` }
  }

  private async rest(path: string, init?: RequestInit) {
    const response = await fetch(`${this.grant.apiUrl.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: { ...this.headers, "content-type": "application/json" },
      cache: "no-store",
    })
    if (response.status === 401) throw new CloudHikeAuthError()
    if (response.ok) return response
    const body = await response.json().catch(() => null)
    throw new CloudHikeError(body?.message ?? body?.error ?? `CloudHike answered ${response.status}.`)
  }

  private async withMcp<T>(use: (server: MCPServerStreamableHttp) => Promise<T>) {
    const server = new MCPServerStreamableHttp({
      name: "cloudhike",
      url: this.grant.mcpUrl,
      requestInit: { headers: this.headers },
    })
    await server.connect()
    try {
      return await use(server)
    } finally {
      await server.close().catch(() => {})
    }
  }

  /** The name of a tool's argument, which CloudHike's docs don't list, from the schema the tool publishes. */
  private async argumentName(server: MCPServerStreamableHttp, tool: string, pattern: RegExp, fallback: string) {
    const tools = await server.listTools()
    const properties = tools.find((t) => t.name === tool)?.inputSchema?.properties ?? {}
    return Object.keys(properties).find((name) => pattern.test(name)) ?? fallback
  }

  private async callTool(server: MCPServerStreamableHttp, tool: string, args: Record<string, unknown>) {
    const result = await server.callToolResult(tool, args)
    const text = result.content
      .map((part) => (part.type === "text" ? String(part.text) : ""))
      .join("\n")
    if (result.isError) throw new CloudHikeError(text || `CloudHike couldn't run ${tool}.`)
    return text
  }

  async findProject(name: string) {
    const response = await this.rest("/projects")
    const { projects } = (await response.json()) as { projects: { id: string; name: string; slug: string }[] }
    const found = projects.find((project) => project.name === name)
    return found ? toProject(found) : null
  }

  async createProject(name: string) {
    await this.withMcp((server) => this.callTool(server, "create_project", { name }))
    const created = await this.findProject(name)
    if (!created) throw new CloudHikeError("CloudHike didn't create the project.")
    return created
  }

  async getProject(id: string) {
    const response = await this.rest(`/projects/${encodeURIComponent(id)}`)
    const data = await response.json()
    const project = data.project ?? data
    return { project: toProject({ ...project, id }), services: toServices(project.services ?? data.services) }
  }

  /** Starts deploying services. One that's already deployed is fine. */
  async deployServices(projectId: string, services: BackendService[], acceptEmailPolicy: boolean) {
    const policy = services.includes("email") && acceptEmailPolicy ? { acceptEmailPolicy: true } : {}
    await this.withMcp(async (server) => {
      const project = await this.argumentName(server, "deploy_services", /project/i, "projectId")
      const list = await this.argumentName(server, "deploy_services", /^(services|types)$/i, "services")
      const answer = await this.callTool(server, "deploy_services", { [project]: projectId, [list]: services, ...policy })
      const refused = deployRefusal(answer)
      if (refused) throw new CloudHikeError(refused)
    })
  }

  async getEnvironment(projectId: string) {
    const response = await this.rest(`/projects/${encodeURIComponent(projectId)}/env`)
    return parseEnvFile(await response.text())
  }
}
