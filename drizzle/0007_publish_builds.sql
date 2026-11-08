CREATE TYPE "public"."app_build_format" AS ENUM('aab', 'apk', 'ipa');--> statement-breakpoint
CREATE TYPE "public"."app_build_platform" AS ENUM('android', 'ios');--> statement-breakpoint
CREATE TYPE "public"."app_build_status" AS ENUM('queued', 'building', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "app_builds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" integer NOT NULL,
	"platform" "app_build_platform" NOT NULL,
	"format" "app_build_format" NOT NULL,
	"version" text NOT NULL,
	"status" "app_build_status" DEFAULT 'queued' NOT NULL,
	"eas_build_id" text,
	"artifact_url" text,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expo_connections" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"access_token" text NOT NULL,
	"account_name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_publishing" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"android_package" text NOT NULL,
	"ios_bundle_identifier" text NOT NULL,
	"version" text NOT NULL,
	"eas_owner" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app_builds" ADD CONSTRAINT "app_builds_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_builds" ADD CONSTRAINT "app_builds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expo_connections" ADD CONSTRAINT "expo_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_publishing" ADD CONSTRAINT "project_publishing_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_builds_project_id_idx" ON "app_builds" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_builds_one_active_idx" ON "app_builds" USING btree ("project_id") WHERE status in ('queued', 'building');