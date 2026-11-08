// Commits a project to a repository through GitHub's Git Data API, without a checkout.
// The default branch only ever gets a repository's first commit. Every later push, and
// every first push to a repository that already has code, goes to a new branch.

import { createHash, randomBytes } from "node:crypto"

import { componentLabel } from "@/lib/agent-protocol"
import type { ExportedFile } from "@/lib/generated-app/export-project"
import { GitHubError, branchPath, type GitHubClient, type GitHubRepo } from "@/lib/github/client"
import type { GitHubPushResult } from "@/lib/github-protocol"

const UPLOADS_AT_ONCE = 6

export type FileChanges = { added: string[]; updated: string[]; removed: string[] }

/**
 * What AppForge has pushed, by path: each file's git blob id, or null once it's been removed.
 * Removed files stay listed because each new branch starts from the default branch, which
 * can still have a file that was only removed on a branch nobody merged.
 */
export type PushedFiles = Record<string, string | null>

/** The id git gives a file with this content, so changes show without asking GitHub. */
export function gitBlobSha(content: string) {
  const bytes = Buffer.from(content, "utf8")
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex")
}

export function compareFiles(previous: PushedFiles, current: Record<string, string>): FileChanges {
  return {
    added: Object.keys(current).filter((path) => !previous[path]),
    updated: Object.keys(current).filter((path) => previous[path] && previous[path] !== current[path]),
    removed: Object.keys(previous).filter((path) => previous[path] && !(path in current)),
  }
}

export const changeCount = ({ added, updated, removed }: FileChanges) => added.length + updated.length + removed.length

/** What a file is to the person who built the app, so a commit reads in their words. Null for the plumbing. */
function fileLabel(path: string, screenNames: Record<string, string>) {
  if (screenNames[path]) return `${screenNames[path]} screen`
  const component = path.match(/^components\/(.+)\.tsx$/)
  if (component) return `${componentLabel(component[1])} component`
  if (path === "app/(tabs)/_layout.tsx") return "tab bar"
  if (path.startsWith("theme/")) return "theme"
  if (path.startsWith("data/")) return "app data"
  if (path.startsWith("lib/backend/")) return "backend setup"
  const screen = path.match(/^app\/(?:\(tabs\)\/)?(?!_layout)([^/]+)\.tsx$/)
  if (screen) return `${screen[1].replace(/-/g, " ")} screen`
  return null
}

function listLabels(labels: string[]) {
  if (labels.length <= 2) return labels.join(" and ")
  return `${labels[0]}, ${labels[1]} and ${labels.length - 2} more`
}

/** A subject that says what changed, and a body that lists every file. */
export function updateCommitMessage(changes: FileChanges, screenNames: Record<string, string>) {
  const labelsOf = (paths: string[]) => [...new Set(paths.flatMap((path) => fileLabel(path, screenNames) ?? []))]
  const phrases = [
    ["Add", labelsOf(changes.added)],
    ["Update", labelsOf(changes.updated)],
    ["Remove", labelsOf(changes.removed)],
  ]
    .filter(([, labels]) => labels.length > 0)
    .map(([verb, labels]) => `${verb} ${listLabels(labels as string[])}`)

  const total = changeCount(changes)
  const joined = phrases.map((phrase, i) => (i === 0 ? phrase : phrase[0].toLowerCase() + phrase.slice(1))).join(", ")
  const subject = joined && joined.length <= 72 ? joined : joined ? `Update ${total} ${total === 1 ? "file" : "files"} across the app` : "Update project configuration"

  const section = (title: string, paths: string[]) => (paths.length ? [`${title}:`, ...paths.map((path) => `- ${path}`), ""] : [])
  const body = [...section("Added", changes.added), ...section("Updated", changes.updated), ...section("Removed", changes.removed), "Pushed from AppForge."]
  return `${subject}\n\n${body.join("\n")}`
}

function firstCommitMessage(appName: string, fileCount: number) {
  return `Add ${appName} Expo project\n\n${fileCount} files: the screens, shared components, theme, data, backend setup, and project configuration.\n\nPushed from AppForge.`
}

/** A branch name that sorts by time, such as `appforge/update-20261101-143012`. */
function branchName(kind: "update" | "initial", attempt: number) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)
  return `appforge/${kind}-${stamp}${attempt > 0 ? `-${randomBytes(2).toString("hex")}` : ""}`
}

async function uploadBlobs(
  github: GitHubClient,
  repository: string,
  files: ExportedFile[],
  onUploaded: (done: number) => void
) {
  const shas = new Map<string, string>()
  let next = 0
  let done = 0
  // One after another inside each worker, because GitHub limits how many writes can arrive together.
  await Promise.all(
    Array.from({ length: Math.min(UPLOADS_AT_ONCE, files.length) }, async () => {
      while (next < files.length) {
        const file = files[next++]
        const blob = await github.request<{ sha: string }>(`/repos/${repository}/git/blobs`, {
          method: "POST",
          body: { content: file.content, encoding: "utf-8" },
        })
        shas.set(file.path, blob.sha)
        onUploaded(++done)
      }
    })
  )
  return shas
}

export type PushInput = {
  repo: GitHubRepo
  appName: string
  files: ExportedFile[]
  screenNames: Record<string, string>
  /** What the last push sent, or null if this is the first one. */
  previous: PushedFiles | null
  lastBranch: string | null
}

export type PushOutcome = GitHubPushResult & { commitSha: string | null; pushedFiles: PushedFiles }

export async function pushFiles(
  github: GitHubClient,
  { repo, appName, files, screenNames, previous, lastBranch }: PushInput,
  onProgress: (label: string, percent: number) => void
): Promise<PushOutcome> {
  const repository = repo.full_name
  const branchUrl = (branch: string) => `${repo.html_url}/tree/${branchPath(branch)}`
  const current = Object.fromEntries(files.map((file) => [file.path, gitBlobSha(file.content)]))
  const changes = compareFiles(previous ?? {}, current)
  const removedPaths = Object.keys(previous ?? {}).filter((path) => !(path in current))
  const pushedFiles: PushedFiles = { ...Object.fromEntries(removedPaths.map((path) => [path, null])), ...current }
  const upToDate = (branch: string, commitSha: string | null): PushOutcome => ({
    outcome: "up-to-date",
    repository,
    branch,
    newBranch: false,
    commitMessage: null,
    filesChanged: 0,
    url: branchUrl(branch),
    compareUrl: null,
    commitSha,
    pushedFiles,
  })

  onProgress("Checking the repository…", 5)
  let head = await github.branchHead(repository, repo.default_branch)

  // Nothing new since the last push, and that push is still there. If its branch was
  // deleted, carry on: if it was merged the code is already on the default branch.
  if (head && previous && changeCount(changes) === 0 && lastBranch && (await github.branchHead(repository, lastBranch))) {
    return upToDate(lastBranch, null)
  }

  const empty = !head
  if (!head) {
    // Git's other write APIs refuse an empty repository. This one starts its history.
    onProgress("Setting up the empty repository…", 10)
    const readme = files.find((file) => file.path === "README.md")!
    const seeded = await github.request<{ commit: { sha: string } }>(`/repos/${repository}/contents/README.md`, {
      method: "PUT",
      body: { message: "Initial commit", content: Buffer.from(readme.content, "utf8").toString("base64") },
    })
    head = seeded.commit.sha
  }

  // What's there now decides what to send. Files the repository has that this project
  // never pushed are left alone: only files AppForge itself pushed get removed.
  let baseTree: string | null = null
  let existing: Record<string, string> = {}
  if (!empty) {
    const commit = await github.request<{ tree: { sha: string } }>(`/repos/${repository}/git/commits/${head}`)
    baseTree = commit.tree.sha
    const tree = await github.request<{ tree: { path: string; type: string; sha: string }[] }>(
      `/repos/${repository}/git/trees/${baseTree}?recursive=1`
    )
    existing = Object.fromEntries(tree.tree.filter((entry) => entry.type === "blob").map((entry) => [entry.path, entry.sha]))
  }

  const toUpload = files.filter((file) => existing[file.path] !== current[file.path])
  const toRemove = removedPaths.filter((path) => path in existing)
  if (toUpload.length === 0 && toRemove.length === 0) return upToDate(repo.default_branch, head)

  onProgress(`Uploading files (0 of ${toUpload.length})…`, 15)
  const blobs = await uploadBlobs(github, repository, toUpload, (done) => {
    onProgress(`Uploading files (${done} of ${toUpload.length})…`, 15 + Math.round((done / toUpload.length) * 65))
  })

  onProgress("Creating the commit…", 85)
  const tree = await github.request<{ sha: string }>(`/repos/${repository}/git/trees`, {
    method: "POST",
    body: {
      ...(baseTree ? { base_tree: baseTree } : {}),
      tree: [
        ...toUpload.map((file) => ({ path: file.path, mode: "100644", type: "blob", sha: blobs.get(file.path) })),
        ...toRemove.map((path) => ({ path, mode: "100644", type: "blob", sha: null })),
      ],
    },
  })
  // Compared with the last push when there is one, which is what the person changed. A push
  // that only differs from the default branch, because its branch was deleted, says so too.
  const sinceLastPush = changeCount(changes) > 0 ? changes : { added: [], updated: toUpload.map((file) => file.path), removed: toRemove }
  const commitMessage = previous && !empty ? updateCommitMessage(sinceLastPush, screenNames) : firstCommitMessage(appName, files.length)
  const commit = await github.request<{ sha: string; html_url: string }>(`/repos/${repository}/git/commits`, {
    method: "POST",
    body: { message: commitMessage, tree: tree.sha, parents: [head] },
  })

  const shared = {
    outcome: "pushed" as const,
    repository,
    commitMessage,
    filesChanged: toUpload.length + toRemove.length,
    commitSha: commit.sha,
    pushedFiles,
  }

  if (empty) {
    onProgress(`Updating ${repo.default_branch}…`, 95)
    await github.request(`/repos/${repository}/git/refs/heads/${branchPath(repo.default_branch)}`, {
      method: "PATCH",
      body: { sha: commit.sha, force: false },
    })
    return { ...shared, branch: repo.default_branch, newBranch: false, url: branchUrl(repo.default_branch), compareUrl: null }
  }

  const kind = previous ? "update" : "initial"
  for (let attempt = 0; ; attempt++) {
    const branch = branchName(kind, attempt)
    onProgress(`Creating branch ${branch}…`, 95)
    try {
      await github.request(`/repos/${repository}/git/refs`, {
        method: "POST",
        body: { ref: `refs/heads/${branch}`, sha: commit.sha },
      })
    } catch (cause) {
      // Two pushes in the same second want the same name.
      if (cause instanceof GitHubError && cause.status === 422 && attempt === 0) continue
      throw cause
    }
    return {
      ...shared,
      branch,
      newBranch: true,
      url: branchUrl(branch),
      compareUrl: `${repo.html_url}/compare/${branchPath(repo.default_branch)}...${branchPath(branch)}?expand=1`,
    }
  }
}
