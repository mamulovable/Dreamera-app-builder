// Types shared by the GitHub routes (server) and the push dialog (client).
// The push route streams `GitHubPushEvent`s as newline-delimited JSON.

export const GITHUB_CONNECT_RESULTS = ["connected", "denied", "error"] as const
export type GitHubConnectResult = (typeof GITHUB_CONNECT_RESULTS)[number]

export type GitHubLinkedRepository = {
  fullName: string
  url: string
  /** Null once the project has been pushed, or if GitHub couldn't be asked. */
  empty: boolean | null
  defaultBranch: string | null
  lastBranch: string | null
  lastPushedAt: string | null
}

export type GitHubStatus = {
  /** Whether this AppForge server has GitHub set up. */
  available: boolean
  account: { login: string } | null
  repository: GitHubLinkedRepository | null
}

export type GitHubRepositoryOption = {
  fullName: string
  private: boolean
  defaultBranch: string
}

export type GitHubPushResult = {
  outcome: "pushed" | "up-to-date"
  repository: string
  branch: string
  /** True when the code went to a new branch rather than the default one. */
  newBranch: boolean
  commitMessage: string | null
  filesChanged: number
  url: string
  /** Where to open a pull request for the new branch. */
  compareUrl: string | null
}

export type GitHubErrorCode =
  /** GitHub no longer accepts the connection, so the person has to connect again. */
  | "reauth"
  /** The linked repository is gone or can't be pushed to, so the person has to pick another. */
  | "repository"

export type GitHubPushEvent =
  | { type: "progress"; label: string; /** How far along, from 0 to 100. */ percent: number }
  | { type: "done"; result: GitHubPushResult }
  | { type: "error"; message: string; code?: GitHubErrorCode }
