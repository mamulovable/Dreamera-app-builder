// A person's GitHub connection and the repository each of their projects pushes to. Server only.

import { eq } from "drizzle-orm"

import { db, githubConnections, projectGithubRepos, type Project } from "@/db"
import { seal, unseal } from "@/lib/cloudhike/crypto"
import { GitHubClient, GitHubError, isGitHubAvailable, revokeGitHubToken, type GitHubRepo } from "@/lib/github/client"
import { pushFiles } from "@/lib/github/push"
import type { GitHubPushResult, GitHubRepositoryOption, GitHubStatus } from "@/lib/github-protocol"
import { loadProjectExport } from "@/lib/project-access"

export const REPO_FULL_NAME = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/
export const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/

export async function saveGitHubConnection(userId: number, accessToken: string) {
  const { login } = await new GitHubClient(accessToken).getUser()
  const values = { accessToken: seal(accessToken), login }
  await db
    .insert(githubConnections)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: githubConnections.userId, set: values })
}

async function loadConnection(userId: number) {
  const [row] = await db.select().from(githubConnections).where(eq(githubConnections.userId, userId))
  return row ?? null
}

/** This person's client, or an error asking them to connect. */
async function requireClient(userId: number) {
  const connection = await loadConnection(userId)
  if (!connection) throw new GitHubError("Connect your GitHub account first.", 401, "reauth")
  return new GitHubClient(unseal(connection.accessToken))
}

/** Runs something with GitHub. A connection GitHub no longer accepts is forgotten, so the dialog asks again. */
async function withClient<T>(userId: number, use: (github: GitHubClient) => Promise<T>) {
  try {
    return await use(await requireClient(userId))
  } catch (cause) {
    if (cause instanceof GitHubError && cause.code === "reauth") {
      await db.delete(githubConnections).where(eq(githubConnections.userId, userId))
    }
    throw cause
  }
}

export async function disconnectGitHub(userId: number) {
  const connection = await loadConnection(userId)
  if (!connection) return
  await db.delete(githubConnections).where(eq(githubConnections.userId, userId))
  // The token is already gone from here, so a failure on GitHub's side doesn't stop this.
  await revokeGitHubToken(unseal(connection.accessToken)).catch((cause) => console.error("Revoking a GitHub token failed", cause))
}

export async function getGitHubStatus(projectId: string, userId: number): Promise<GitHubStatus> {
  const [connection, [link]] = await Promise.all([
    loadConnection(userId),
    db.select().from(projectGithubRepos).where(eq(projectGithubRepos.projectId, projectId)),
  ])
  const status: GitHubStatus = {
    available: isGitHubAvailable(),
    account: connection ? { login: connection.login } : null,
    repository: null,
  }
  if (!link) return status

  const fullName = `${link.owner}/${link.name}`
  status.repository = {
    fullName,
    url: `https://github.com/${fullName}`,
    empty: null,
    defaultBranch: null,
    lastBranch: link.lastBranch,
    lastPushedAt: link.lastPushedAt?.toISOString() ?? null,
  }
  // Before the first push the dialog says where the code will go, which depends on what's there.
  if (connection && status.available && !link.lastPushedAt) {
    await withClient(userId, async (github) => {
      const repo = await github.getRepo(fullName)
      if (!repo) return
      status.repository!.defaultBranch = repo.default_branch
      status.repository!.empty = !(await github.branchHead(fullName, repo.default_branch))
    }).catch((cause) => {
      if (cause instanceof GitHubError && cause.code === "reauth") status.account = null
    })
  }
  return status
}

export async function listRepositories(userId: number): Promise<GitHubRepositoryOption[]> {
  const repos = await withClient(userId, (github) => github.listPushableRepos())
  return repos.map((repo) => ({ fullName: repo.full_name, private: repo.private, defaultBranch: repo.default_branch }))
}

async function linkRepo(projectId: string, repo: GitHubRepo) {
  // A different repository knows nothing of earlier pushes, so the next one counts as its first.
  const values = {
    owner: repo.owner.login,
    name: repo.name,
    lastBranch: null,
    lastCommitSha: null,
    lastPushedAt: null,
    pushedFiles: null,
  }
  await db
    .insert(projectGithubRepos)
    .values({ projectId, ...values })
    .onConflictDoUpdate({ target: projectGithubRepos.projectId, set: values })
}

export async function linkExistingRepository(projectId: string, userId: number, fullName: string) {
  await withClient(userId, async (github) => {
    const repo = await github.getRepo(fullName)
    if (!repo) throw new GitHubError("We couldn't find that repository on your GitHub account.", 404, "repository")
    if (!repo.permissions?.push) throw new GitHubError("You don't have permission to push to that repository.", 403, "repository")
    if (repo.archived) throw new GitHubError("That repository is archived, so it can't be pushed to.", 403, "repository")
    await linkRepo(projectId, repo)
  })
}

export async function createAndLinkRepository(projectId: string, userId: number, name: string, isPrivate: boolean, description: string) {
  await withClient(userId, async (github) => {
    const repo = await github.createRepo(name, isPrivate, description).catch((cause) => {
      if (cause instanceof GitHubError && cause.status === 422) {
        throw new GitHubError(`You already have a repository called ${name}, or GitHub doesn't accept that name. Try another.`, 422, "repository")
      }
      throw cause
    })
    await linkRepo(projectId, repo)
  })
}

/** Pushes the project to its linked repository, and remembers what was sent. */
export async function pushProject(
  project: Project,
  userId: number,
  onProgress: (label: string, percent: number) => void
): Promise<GitHubPushResult> {
  const [link] = await db.select().from(projectGithubRepos).where(eq(projectGithubRepos.projectId, project.id))
  if (!link) throw new GitHubError("Choose a repository first.", 400, "repository")

  onProgress("Packaging your project…", 2)
  const { name, files, screenNames } = await loadProjectExport(project)

  return withClient(userId, async (github) => {
    const repo = await github.getRepo(`${link.owner}/${link.name}`)
    if (!repo) {
      await db.delete(projectGithubRepos).where(eq(projectGithubRepos.projectId, project.id))
      throw new GitHubError(`${link.owner}/${link.name} no longer exists, or you've lost access to it. Choose another repository.`, 404, "repository")
    }
    if (!repo.permissions?.push || repo.archived) {
      throw new GitHubError(`You can't push to ${repo.full_name} anymore. Choose another repository.`, 403, "repository")
    }

    const { commitSha, pushedFiles, ...result } = await pushFiles(
      github,
      { repo, appName: name, files, screenNames, previous: link.pushedFiles, lastBranch: link.lastBranch },
      onProgress
    )
    // A rename on GitHub redirects the old name, so keep following the current one.
    await db
      .update(projectGithubRepos)
      .set({
        owner: repo.owner.login,
        name: repo.name,
        pushedFiles,
        ...(result.outcome === "pushed" ? { lastBranch: result.branch, lastCommitSha: commitSha, lastPushedAt: new Date() } : {}),
      })
      .where(eq(projectGithubRepos.projectId, project.id))
    return result
  })
}
