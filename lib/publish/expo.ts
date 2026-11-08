// Server-only client for Expo's GraphQL API, the one the EAS CLI itself uses. Never import this from client components.
// It isn't a documented API, so everything that depends on its shape is kept in this file.

import { createHash, randomBytes } from "node:crypto"

const GRAPHQL_URL = "https://api.expo.dev/graphql"

/** Something Expo said no to. `unauthorized` means the person's token has to be replaced. */
export class ExpoError extends Error {
  constructor(
    message: string,
    public unauthorized = false,
    public code?: string
  ) {
    super(message)
  }
}

async function expoRequest<T>(accessToken: string, query: string, variables: object = {}): Promise<T> {
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  })
  const result = (await response.json().catch(() => null)) as {
    data?: T
    errors?: { message?: string; extensions?: { errorCode?: string } }[]
  } | null
  const unauthorized = response.status === 401 || Boolean(result?.errors?.some((error) => /UNAUTHORIZED|UNAUTHENTICATED/.test(error.extensions?.errorCode ?? "")))
  if (unauthorized) throw new ExpoError("Expo no longer accepts this token. Connect your account again.", true)
  if (!response.ok || !result?.data || result.errors?.length) {
    const error = result?.errors?.[0]
    throw new ExpoError(error?.message ?? `Expo answered ${response.status}.`, false, error?.extensions?.errorCode)
  }
  return result.data
}

/** Expo only finds a project by its full name with the `@`. */
function fullName(owner: string, slug: string) {
  return `@${owner}/${slug}`
}

/** Null if the project doesn't exist yet: it's only created at the first build, or by the person. */
async function orNotFound<T>(request: Promise<T>) {
  return request.catch((cause) => {
    if (cause instanceof ExpoError && cause.code === "EXPERIENCE_NOT_FOUND") return null
    throw cause
  })
}

/** The account a token builds under: the person's own, or for a robot token its organization. */
export async function expoAccountName(accessToken: string) {
  const { meActor } = await expoRequest<{
    meActor: { primaryAccount?: { name: string } | null; accounts: { name: string }[] } | null
  }>(
    accessToken,
    `query { meActor { __typename ... on UserActor { primaryAccount { name } } accounts { name } } }`
  )
  const name = meActor?.primaryAccount?.name ?? meActor?.accounts[0]?.name
  if (!name) throw new ExpoError("This token doesn't belong to an Expo account.", true)
  return name
}

/** Finds the app's EAS project, or creates it. The owner and slug never change, so neither does the project. */
export async function ensureExpoApp(accessToken: string, owner: string, slug: string) {
  const found = await orNotFound(
    expoRequest<{ app: { byFullName: { id: string; ownerAccount: { id: string } } } }>(
      accessToken,
      `query ($fullName: String!) { app { byFullName(fullName: $fullName) { id ownerAccount { id } } } }`,
      { fullName: fullName(owner, slug) }
    )
  )
  if (found) return { appId: found.app.byFullName.id, accountId: found.app.byFullName.ownerAccount.id }

  const { account } = await expoRequest<{ account: { byName: { id: string } } }>(
    accessToken,
    `query ($accountName: String!) { account { byName(accountName: $accountName) { id } } }`,
    { accountName: owner }
  )
  const { app } = await expoRequest<{ app: { createApp: { id: string } } }>(
    accessToken,
    `mutation ($appInput: AppInput!) { app { createApp(appInput: $appInput) { id } } }`,
    { appInput: { accountId: account.byName.id, projectName: slug } }
  )
  return { appId: app.createApp.id, accountId: account.byName.id }
}

/** Whether EAS holds a distribution certificate and provisioning profile for this app's App Store builds. */
export async function hasIosCredentials(accessToken: string, owner: string, slug: string, bundleIdentifier: string) {
  const data = await orNotFound(
    expoRequest<{
      app: {
        byFullName: {
          iosAppCredentials: {
            appleAppIdentifier: { bundleIdentifier: string }
            iosAppBuildCredentialsList: { distributionCertificate: { id: string } | null; provisioningProfile: { id: string } | null }[]
          }[]
        }
      }
    }>(
      accessToken,
      `query ($fullName: String!) {
        app {
          byFullName(fullName: $fullName) {
            iosAppCredentials {
              appleAppIdentifier { bundleIdentifier }
              iosAppBuildCredentialsList(filter: { iosDistributionType: APP_STORE }) {
                distributionCertificate { id }
                provisioningProfile { id }
              }
            }
          }
        }
      }`,
      { fullName: fullName(owner, slug) }
    )
  )
  return Boolean(
    data?.app.byFullName.iosAppCredentials.some(
      (credentials) =>
        credentials.appleAppIdentifier.bundleIdentifier === bundleIdentifier &&
        credentials.iosAppBuildCredentialsList.some((build) => build.distributionCertificate && build.provisioningProfile)
    )
  )
}

/** Expo makes the keystore, on its own servers, from the passwords it's given. Nothing is kept here. */
async function generateKeystore(accessToken: string) {
  const { keystoreGenerationUrl } = await expoRequest<{ keystoreGenerationUrl: { createKeystoreGenerationUrl: { url: string } } }>(
    accessToken,
    `mutation { keystoreGenerationUrl { createKeystoreGenerationUrl { id url } } }`
  )
  const response = await fetch(keystoreGenerationUrl.createKeystoreGenerationUrl.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      keystorePassword: randomBytes(16).toString("hex"),
      keyPassword: randomBytes(16).toString("hex"),
      keyAlias: randomBytes(16).toString("hex"),
    }),
    cache: "no-store",
  })
  const keystore = (await response.json().catch(() => null)) as {
    keystoreBase64?: string
    keystorePassword: string
    keyAlias: string
    keyPassword: string
  } | null
  if (!response.ok || !keystore?.keystoreBase64) throw new ExpoError("Expo couldn't create a signing key for this app. Please try again.")
  return keystore
}

/**
 * A build started without someone at a terminal won't create a keystore, so a new app gets one here.
 * An app that already has one is left alone: replacing it would lock the app out of its store listing.
 */
export async function ensureAndroidKeystore(accessToken: string, owner: string, slug: string, androidPackage: string) {
  const { app } = await expoRequest<{
    app: {
      byFullName: {
        id: string
        ownerAccount: { id: string }
        androidAppCredentials: { id: string; androidAppBuildCredentialsList: { id: string; isDefault: boolean; androidKeystore: { id: string } | null }[] }[]
      }
    }
  }>(
    accessToken,
    `query ($fullName: String!, $applicationIdentifier: String) {
      app {
        byFullName(fullName: $fullName) {
          id
          ownerAccount { id }
          androidAppCredentials(filter: { applicationIdentifier: $applicationIdentifier }) {
            id
            androidAppBuildCredentialsList { id isDefault androidKeystore { id } }
          }
        }
      }
    }`,
    { fullName: fullName(owner, slug), applicationIdentifier: androidPackage }
  )
  const project = app.byFullName
  const existingCredentials = project.androidAppCredentials[0] ?? null
  const existing = (existingCredentials?.androidAppBuildCredentialsList ?? []).filter((item) => item.androidKeystore)
  if (existing.some((item) => item.isDefault)) return
  if (existing.length > 0) {
    throw new ExpoError("This app has Android credentials on EAS, but none is the default. Choose one with: eas credentials --platform android")
  }

  const keystore = await generateKeystore(accessToken)
  const { androidKeystore } = await expoRequest<{ androidKeystore: { createAndroidKeystore: { id: string } } }>(
    accessToken,
    `mutation ($androidKeystoreInput: AndroidKeystoreInput!, $accountId: ID!) {
      androidKeystore { createAndroidKeystore(androidKeystoreInput: $androidKeystoreInput, accountId: $accountId) { id } }
    }`,
    {
      androidKeystoreInput: {
        base64EncodedKeystore: keystore.keystoreBase64,
        keystorePassword: keystore.keystorePassword,
        keyAlias: keystore.keyAlias,
        keyPassword: keystore.keyPassword,
      },
      accountId: project.ownerAccount.id,
    }
  )
  const credentialsId =
    existingCredentials?.id ??
    (
      await expoRequest<{ androidAppCredentials: { createAndroidAppCredentials: { id: string } } }>(
        accessToken,
        `mutation ($androidAppCredentialsInput: AndroidAppCredentialsInput!, $appId: ID!, $applicationIdentifier: String!) {
          androidAppCredentials {
            createAndroidAppCredentials(androidAppCredentialsInput: $androidAppCredentialsInput, appId: $appId, applicationIdentifier: $applicationIdentifier) { id }
          }
        }`,
        { androidAppCredentialsInput: {}, appId: project.id, applicationIdentifier: androidPackage }
      )
    ).androidAppCredentials.createAndroidAppCredentials.id
  await expoRequest(
    accessToken,
    `mutation ($androidAppBuildCredentialsInput: AndroidAppBuildCredentialsInput!, $androidAppCredentialsId: ID!) {
      androidAppBuildCredentials {
        createAndroidAppBuildCredentials(androidAppBuildCredentialsInput: $androidAppBuildCredentialsInput, androidAppCredentialsId: $androidAppCredentialsId) { id }
      }
    }`,
    {
      androidAppBuildCredentialsInput: { name: "AppForge", isDefault: true, keystoreId: androidKeystore.createAndroidKeystore.id },
      androidAppCredentialsId: credentialsId,
    }
  )
}

/** Uploads one file for a workflow run, and answers with the key the run refers to it by. */
async function uploadSource(accessToken: string, accountId: string, content: Buffer) {
  const { uploadSession } = await expoRequest<{
    uploadSession: { createAccountScopedUploadSession: { url: string; headers?: Record<string, string>; bucketKey: string } }
  }>(
    accessToken,
    `mutation ($accountID: ID!, $type: AccountUploadSessionType!) {
      uploadSession { createAccountScopedUploadSession(accountID: $accountID, type: $type) }
    }`,
    { accountID: accountId, type: "WORKFLOWS_PROJECT_SOURCES" }
  )
  const { url, headers, bucketKey } = uploadSession.createAccountScopedUploadSession
  const response = await fetch(url, {
    method: "PUT",
    headers: { ...headers, "content-md5": createHash("md5").update(content).digest("base64") },
    body: new Uint8Array(content),
    cache: "no-store",
  })
  if (!response.ok) throw new ExpoError(`Uploading the project to Expo failed (${response.status}). Please try again.`)
  return bucketKey
}

/** Hands the project to EAS and starts the workflow that builds it. Answers with the run's id. */
export async function startWorkflowRun(
  accessToken: string,
  { appId, accountId, workflow, tarball, easJson, packageJson }: {
    appId: string
    accountId: string
    workflow: { fileName: string; yamlConfig: string }
    tarball: Buffer
    easJson: string
    packageJson: string
  }
) {
  const [projectArchiveBucketKey, easJsonBucketKey, packageJsonBucketKey] = await Promise.all([
    uploadSource(accessToken, accountId, tarball),
    uploadSource(accessToken, accountId, Buffer.from(easJson)),
    uploadSource(accessToken, accountId, Buffer.from(packageJson)),
  ])
  const { workflowRun } = await expoRequest<{ workflowRun: { createWorkflowRun: { id: string } } }>(
    accessToken,
    `mutation ($appId: ID!, $workflowRevisionInput: WorkflowRevisionInput!, $workflowRunInput: WorkflowRunInput!) {
      workflowRun {
        createWorkflowRun(appId: $appId, workflowRevisionInput: $workflowRevisionInput, workflowRunInput: $workflowRunInput) { id }
      }
    }`,
    {
      appId,
      workflowRevisionInput: workflow,
      workflowRunInput: {
        projectSource: { type: "GCS", projectArchiveBucketKey, easJsonBucketKey, packageJsonBucketKey, projectRootDirectory: "." },
      },
    }
  )
  return workflowRun.createWorkflowRun.id
}

type ErrorDetail = { title?: string | null; message?: string | null }

export type WorkflowRunState = {
  status: "NEW" | "WAITING" | "IN_PROGRESS" | "ACTION_REQUIRED" | "SUCCESS" | "FAILURE" | "CANCELED"
  errors: ErrorDetail[]
  jobs: {
    errors: ErrorDetail[]
    turtleBuild: {
      id: string
      status: "NEW" | "IN_QUEUE" | "IN_PROGRESS" | "PENDING_CANCEL" | "FINISHED" | "ERRORED" | "CANCELED"
      error: { message?: string | null } | null
      artifacts: { buildUrl?: string | null; applicationArchiveUrl?: string | null } | null
    } | null
  }[]
}

export async function readWorkflowRun(accessToken: string, workflowRunId: string) {
  const { workflowRuns } = await expoRequest<{ workflowRuns: { byId: WorkflowRunState } }>(
    accessToken,
    `query ($workflowRunId: ID!) {
      workflowRuns {
        byId(workflowRunId: $workflowRunId) {
          status
          errors { title message }
          jobs {
            errors { title message }
            turtleBuild {
              id
              status
              error { message }
              artifacts { buildUrl applicationArchiveUrl }
            }
          }
        }
      }
    }`,
    { workflowRunId }
  )
  return workflowRuns.byId
}

/**
 * The name of the app's site, as in `https://<name>.expo.app`. A deploy from a workflow can't always create
 * one for itself, so a new app gets it here, on the person's own token. An app keeps its name once it has one.
 */
export async function ensureWebDomain(accessToken: string, appId: string) {
  // The suggestion can be taken by someone else between asking and assigning.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { app } = await expoRequest<{ app: { byId: { devDomainName: { name: string } | null; suggestedDevDomainName: string } } }>(
      accessToken,
      `query ($appId: String!) { app { byId(appId: $appId) { id devDomainName { id name } suggestedDevDomainName } } }`,
      { appId }
    )
    if (app.byId.devDomainName) return app.byId.devDomainName.name
    try {
      const { devDomainName } = await expoRequest<{ devDomainName: { assignDevDomainName: { name: string } } }>(
        accessToken,
        `mutation ($appId: ID!, $name: DevDomainName!) { devDomainName { assignDevDomainName(appId: $appId, name: $name) { id name } } }`,
        { appId, name: app.byId.suggestedDevDomainName }
      )
      return devDomainName.assignDevDomainName.name
    } catch (cause) {
      if (cause instanceof ExpoError && cause.code === "DEV_DOMAIN_NAME_TAKEN") continue
      // The token got this far, so it works. It just isn't allowed to do this, as with a robot's token.
      if (cause instanceof ExpoError && cause.unauthorized) {
        throw new ExpoError("This Expo token can't set up a website for the app. Connect a personal access token from an admin of the account.")
      }
      throw cause
    }
  }
  throw new ExpoError("Expo couldn't find a free web address for this app. Please try again.")
}

export type WebRunState = {
  status: WorkflowRunState["status"]
  errors: ErrorDetail[]
  jobs: {
    type: string
    status: "NEW" | "IN_PROGRESS" | "ACTION_REQUIRED" | "PENDING_CANCEL" | "SKIPPED" | "SUCCESS" | "FAILURE" | "CANCELED"
    errors: ErrorDetail[]
    outputs: { deploy_url?: unknown } | null
    turtleJobRun: { logFileUrls: string[] } | null
  }[]
}

export async function readWebRun(accessToken: string, workflowRunId: string) {
  const { workflowRuns } = await expoRequest<{ workflowRuns: { byId: WebRunState } }>(
    accessToken,
    `query ($workflowRunId: ID!) {
      workflowRuns {
        byId(workflowRunId: $workflowRunId) {
          status
          errors { title message }
          jobs {
            type
            status
            errors { title message }
            outputs
            turtleJobRun { logFileUrls }
          }
        }
      }
    }`,
    { workflowRunId }
  )
  return workflowRuns.byId
}

/**
 * Whether a running job has reached its deploy step. Only the job's log says so: each line is JSON naming its step.
 * Not knowing is fine, since the job just shows as building until it finishes.
 */
export async function hasReachedDeployStep(logFileUrl: string) {
  const response = await fetch(logFileUrl, { cache: "no-store" }).catch(() => null)
  if (!response?.ok) return false
  const log = await response.text().catch(() => "")
  return /"buildStepDisplayName"\s*:\s*"[^"]*deploy/i.test(log)
}
