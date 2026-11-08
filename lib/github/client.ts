// Server-only client for GitHub. Never import this from client components.

import type { GitHubErrorCode } from "@/lib/github-protocol"

const GITHUB_URL = "https://github.com"
const API_URL = "https://api.github.com"

export const GITHUB_CALLBACK_PATH = "/api/github/callback"

/** `repo` is the only OAuth scope that lets an app create and push to private repositories. */
const OAUTH_SCOPE = "repo"

/** Something GitHub said no to, in words the person can act on. */
export class GitHubError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: GitHubErrorCode
  ) {
    super(message)
  }
}

/** A branch name for a url. Its slashes stay as they are, since GitHub's routes read them as part of the name. */
export function branchPath(branch: string) {
  return branch.split("/").map(encodeURIComponent).join("/")
}

export function isGitHubAvailable() {
  return Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET && process.env.CLOUDHIKE_ENCRYPTION_KEY)
}

export function githubCallbackUrl(fallbackOrigin: string) {
  return new URL(GITHUB_CALLBACK_PATH, process.env.NEXT_PUBLIC_APP_URL || fallbackOrigin).toString()
}

export function githubAuthorizeUrl(redirectUri: string, state: string) {
  const url = new URL("/login/oauth/authorize", GITHUB_URL)
  url.searchParams.set("client_id", process.env.GITHUB_CLIENT_ID ?? "")
  url.searchParams.set("redirect_uri", redirectUri)
  url.searchParams.set("scope", OAUTH_SCOPE)
  url.searchParams.set("state", state)
  return url
}

/** Trades the code from the callback for an access token. The client secret never leaves this server. */
export async function exchangeGitHubCode(code: string, redirectUri: string) {
  const response = await fetch(`${GITHUB_URL}/login/oauth/access_token`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      code,
      redirect_uri: redirectUri,
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
    }),
    cache: "no-store",
  })
  const data = await response.json().catch(() => null)
  if (!response.ok || !data?.access_token) {
    throw new Error(`GitHub token exchange failed: ${response.status} ${data?.error ?? ""}`)
  }
  return data.access_token as string
}

/** Tells GitHub to forget the token, so disconnecting really ends AppForge's access. */
export async function revokeGitHubToken(accessToken: string) {
  const credentials = Buffer.from(`${process.env.GITHUB_CLIENT_ID}:${process.env.GITHUB_CLIENT_SECRET}`).toString("base64")
  await fetch(`${API_URL}/applications/${process.env.GITHUB_CLIENT_ID}/grant`, {
    method: "DELETE",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Basic ${credentials}`,
      "content-type": "application/json",
      "user-agent": "AppForge",
    },
    body: JSON.stringify({ access_token: accessToken }),
    cache: "no-store",
  })
}

export type GitHubRepo = {
  full_name: string
  name: string
  owner: { login: string }
  private: boolean
  archived: boolean
  default_branch: string
  html_url: string
  permissions?: { push?: boolean }
}

/** Acts for one person, with their token. */
export class GitHubClient {
  constructor(private accessToken: string) {}

  async request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const response = await fetch(`${API_URL}${path}`, {
      method: init.method ?? "GET",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${this.accessToken}`,
        "user-agent": "AppForge",
        "x-github-api-version": "2022-11-28",
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    })
    if (response.ok) return (response.status === 204 ? null : await response.json()) as T

    const body = await response.json().catch(() => null)
    if (response.status === 401) {
      throw new GitHubError("GitHub no longer accepts this connection. Connect your account again.", 401, "reauth")
    }
    if (response.status === 429 || (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0")) {
      throw new GitHubError("GitHub's rate limit was reached. Please try again in a few minutes.", response.status)
    }
    const detail = body?.errors?.[0]?.message ?? body?.message
    throw new GitHubError(detail ? `GitHub said: ${detail}` : `GitHub answered ${response.status}.`, response.status)
  }

  getUser() {
    return this.request<{ login: string }>("/user")
  }

  /** A repository, or null if it's gone or this person can't see it. */
  async getRepo(fullName: string) {
    try {
      return await this.request<GitHubRepo>(`/repos/${fullName}`)
    } catch (cause) {
      if (cause instanceof GitHubError && cause.status === 404) return null
      throw cause
    }
  }

  async createRepo(name: string, isPrivate: boolean, description: string) {
    return this.request<GitHubRepo>("/user/repos", {
      method: "POST",
      body: { name, private: isPrivate, description: description.slice(0, 350) },
    })
  }

  /** The repositories this person can push to, most recently pushed first. */
  async listPushableRepos() {
    const repos: GitHubRepo[] = []
    for (let page = 1; page <= 3; page++) {
      const batch = await this.request<GitHubRepo[]>(
        `/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`
      )
      repos.push(...batch)
      if (batch.length < 100) break
    }
    return repos.filter((repo) => repo.permissions?.push && !repo.archived)
  }

  /** The commit a branch is on, or null if the branch doesn't exist or the repository has no commits yet. */
  async branchHead(fullName: string, branch: string) {
    try {
      const ref = await this.request<{ object: { sha: string } }>(`/repos/${fullName}/git/ref/heads/${branchPath(branch)}`)
      return ref.object.sha
    } catch (cause) {
      if (cause instanceof GitHubError && (cause.status === 404 || cause.status === 409)) return null
      throw cause
    }
  }
}
