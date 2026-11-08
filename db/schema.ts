import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  SCREEN_LAYOUTS,
  SCREEN_STATUSES,
  type AgentEvent,
  type AppPlan,
} from "@/lib/agent-protocol";
import { BACKEND_STATES, type BackendServiceStatus } from "@/lib/backend-protocol";
import { CREDIT_REASONS, FREE_SIGNUP_CREDITS, PLAN_IDS } from "@/lib/plans";
import { PROJECT_PLATFORMS, PROJECT_STATUSES } from "@/lib/projects";
import { APP_BUILD_FORMATS, APP_BUILD_PLATFORMS, APP_BUILD_STATUSES, WEB_PUBLISH_STATUSES } from "@/lib/publish-protocol";

export const userPlan = pgEnum("user_plan", PLAN_IDS);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  /** The user's id in CloudHike Auth. */
  authUserId: text("auth_user_id").notNull().unique(),
  name: text("name"),
  email: text("email").notNull().unique(),
  /** Credits that never expire. Spent after `monthlyCredits`. */
  credits: integer("credits").default(FREE_SIGNUP_CREDITS).notNull(),
  /** Pro's credits for the current period. Replaced at each renewal, and gone when Pro ends. */
  monthlyCredits: integer("monthly_credits").default(0).notNull(),
  plan: userPlan("plan").default("free").notNull(),
  stripeCustomerId: text("stripe_customer_id").unique(),
  /** The subscription that makes this person Pro. Null on Free. */
  stripeSubscriptionId: text("stripe_subscription_id"),
  currentPeriodEnd: timestamp("current_period_end"),
  /** They've downgraded: Pro lasts until `currentPeriodEnd`, and then they're on Free. */
  cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const creditReason = pgEnum("credit_reason", CREDIT_REASONS);

/** Every change to a person's credits. */
export const creditTransactions = pgTable(
  "credit_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Kept after the project is deleted, since the credits were still spent. */
    projectId: uuid("project_id"),
    /** Negative when spent. */
    amount: integer("amount").notNull(),
    /** Both kinds of credit, after this change. */
    balanceAfter: integer("balance_after").notNull(),
    reason: creditReason("reason").notNull(),
    /** What this is for, so a retried request or a repeated webhook can't apply it twice. */
    reference: text("reference").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("credit_transactions_user_id_idx").on(table.userId)]
);

export const projectPlatform = pgEnum("project_platform", PROJECT_PLATFORMS);
export const projectStatus = pgEnum("project_status", PROJECT_STATUSES);
export const messageRole = pgEnum("message_role", ["user", "assistant"]);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    prompt: text("prompt").notNull(),
    platform: projectPlatform("platform").notNull(),
    status: projectStatus("status").default("planning").notNull(),
    /** The latest screen plan from the agent; null until it proposes one. */
    plan: jsonb("plan").$type<AppPlan>(),
    /** Listed on the home page, where anyone can run it on sample data. Only its owner can change this. */
    isPublic: boolean("is_public").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("projects_user_id_idx").on(table.userId),
    index("projects_public_idx").on(table.id).where(sql`is_public`),
  ]
);

/** Reference files the user attached; the bytes live in CloudHike Storage. */
export const projectAssets = pgTable(
  "project_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull().unique(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("project_assets_project_id_idx").on(table.projectId)]
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    role: messageRole("role").notNull(),
    content: text("content").notNull(),
    /** The plan this assistant message proposed, so revisions stay in the chat history. */
    plan: jsonb("plan").$type<AppPlan>(),
    /** Finished with by a completed build: still shown in the chat, but the agent no longer reads it. */
    handled: boolean("handled").default(false).notNull(),
    /** From before the person started a new session: neither shown nor read by the agent. */
    archived: boolean("archived").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("messages_project_id_idx").on(table.projectId)]
);

export const screenStatus = pgEnum("screen_status", SCREEN_STATUSES);
export const screenLayout = pgEnum("screen_layout", SCREEN_LAYOUTS);

/** One generated screen of a project's app, built in `position` order. */
export const screens = pgTable(
  "screens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    status: screenStatus("status").default("pending").notNull(),
    layout: screenLayout("layout").default("home").notNull(),
    filePath: text("file_path").notNull(),
    code: text("code"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("screens_project_id_idx").on(table.projectId),
    uniqueIndex("screens_project_slug_idx").on(table.projectId, table.slug),
  ]
);

export const buildStatus = pgEnum("build_status", ["active", "finished"]);

/** One build of a project's screens, run by CloudHike Jobs one step at a time. */
export const builds = pgTable(
  "builds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    status: buildStatus("status").default("active").notNull(),
    /** The Jobs run for the current step. */
    jobId: text("job_id"),
    /** The current step. Deliveries of earlier steps are duplicates. */
    step: integer("step").default(1).notNull(),
    /** Held by the execution allowed to write. A newer delivery of the step takes it over. */
    lease: uuid("lease"),
    lastSeq: integer("last_seq").default(0).notNull(),
    /** What this build was charged, so a failure can give back what it didn't finish. */
    creditsCharged: integer("credits_charged").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("builds_one_active_idx")
      .on(table.projectId)
      .where(sql`status = 'active'`),
  ]
);

/** What a build has streamed so far, in order. Browsers read this to follow the build. */
export const buildEvents = pgTable(
  "build_events",
  {
    buildId: uuid("build_id")
      .notNull()
      .references(() => builds.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    event: jsonb("event").$type<AgentEvent>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.buildId, table.seq] })]
);

/** A person's link to their CloudHike workspace. One token per person: connecting again replaces it. */
export const cloudhikeConnections = pgTable("cloudhike_connections", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Encrypted with `lib/cloudhike/crypto.ts`. */
  accessToken: text("access_token").notNull(),
  mcpUrl: text("mcp_url").notNull(),
  apiUrl: text("api_url").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const backendState = pgEnum("backend_state", BACKEND_STATES);

/** The CloudHike backend of one generated app. */
export const projectBackends = pgTable("project_backends", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  state: backendState("state").default("linked").notNull(),
  /** Kept after disconnecting, so connecting again reuses the same CloudHike project. */
  cloudhikeProjectId: text("cloudhike_project_id"),
  cloudhikeProjectSlug: text("cloudhike_project_slug"),
  services: jsonb("services").$type<BackendServiceStatus[]>().default([]).notNull(),
  /** The project's .env as JSON, encrypted with `lib/cloudhike/crypto.ts`. Null unless it's in use. */
  environment: text("environment"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

/** Someone a project was shared with. They can open it and download it, but only its owner can change it. */
export const projectShares = pgTable(
  "project_shares",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.userId] }),
    index("project_shares_user_id_idx").on(table.userId),
  ]
);

/** A person's link to their GitHub account. One token per person: connecting again replaces it. */
export const githubConnections = pgTable("github_connections", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Encrypted with `lib/cloudhike/crypto.ts`. */
  accessToken: text("access_token").notNull(),
  login: text("login").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

/** The GitHub repository a project pushes to, and what the last push sent there. */
export const projectGithubRepos = pgTable("project_github_repos", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  owner: text("owner").notNull(),
  name: text("name").notNull(),
  lastBranch: text("last_branch"),
  lastCommitSha: text("last_commit_sha"),
  lastPushedAt: timestamp("last_pushed_at"),
  /** Each file's git blob id as last pushed by path, or null if it was removed. Null until the first push. */
  pushedFiles: jsonb("pushed_files").$type<Record<string, string | null>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

/** A person's link to their Expo account. One token per person: connecting again replaces it. */
export const expoConnections = pgTable("expo_connections", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Encrypted with `lib/cloudhike/crypto.ts`. */
  accessToken: text("access_token").notNull(),
  /** The Expo account that owns this person's EAS projects. */
  accountName: text("account_name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

/** A project's native identity. Set once at its first build, because the stores tie an app to these ids for good. */
export const projectPublishing = pgTable("project_publishing", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  slug: text("slug").notNull(),
  androidPackage: text("android_package").notNull(),
  iosBundleIdentifier: text("ios_bundle_identifier").notNull(),
  /** The last version asked for, which `app.json` carries on every export. */
  version: text("version").notNull(),
  easOwner: text("eas_owner").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export const appBuildPlatform = pgEnum("app_build_platform", APP_BUILD_PLATFORMS);
export const appBuildFormat = pgEnum("app_build_format", APP_BUILD_FORMATS);
export const appBuildStatus = pgEnum("app_build_status", APP_BUILD_STATUSES);

/** One native build of an app, run by EAS. `builds` is the agent's screen generation. */
export const appBuilds = pgTable(
  "app_builds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platform: appBuildPlatform("platform").notNull(),
    format: appBuildFormat("format").notNull(),
    version: text("version").notNull(),
    status: appBuildStatus("status").default("queued").notNull(),
    /** The EAS workflow run this build follows. `easBuildId` is only known once that run has started its build. */
    easRunId: text("eas_run_id"),
    easBuildId: text("eas_build_id"),
    artifactUrl: text("artifact_url"),
    error: text("error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("app_builds_project_id_idx").on(table.projectId),
    // Two at once would race for the app's next versionCode.
    uniqueIndex("app_builds_one_active_idx")
      .on(table.projectId)
      .where(sql`status in ('queued', 'building')`),
  ]
);

export type User = typeof users.$inferSelect;
export const webPublishStatus = pgEnum("web_publish_status", WEB_PUBLISH_STATUSES);

/** A project's website on EAS Hosting. One row per project: publishing again updates the same site. */
export const webPublishes = pgTable("web_publishes", {
  projectId: uuid("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  status: webPublishStatus("status").notNull(),
  /** The EAS workflow run of the latest publish. Null until the project has reached Expo. */
  easRunId: text("eas_run_id"),
  /** The address the latest publish is going to, used if Expo's run doesn't report one. */
  targetUrl: text("target_url"),
  /** The address that's online now. Unlike the status, a failed update doesn't change it. */
  liveUrl: text("live_url"),
  error: text("error"),
  startedAt: timestamp("started_at").notNull(),
  publishedAt: timestamp("published_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type NewUser = typeof users.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type ProjectAsset = typeof projectAssets.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Screen = typeof screens.$inferSelect;
export type ProjectBackend = typeof projectBackends.$inferSelect;
export type ProjectPublishing = typeof projectPublishing.$inferSelect;
export type AppBuild = typeof appBuilds.$inferSelect;
export type WebPublish = typeof webPublishes.$inferSelect;
