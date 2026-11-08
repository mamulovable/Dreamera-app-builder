CREATE TYPE "public"."web_publish_status" AS ENUM('uploading', 'queued', 'building', 'deploying', 'published', 'failed');--> statement-breakpoint
CREATE TABLE "web_publishes" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"status" "web_publish_status" NOT NULL,
	"eas_run_id" text,
	"target_url" text,
	"live_url" text,
	"error" text,
	"started_at" timestamp NOT NULL,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "web_publishes" ADD CONSTRAINT "web_publishes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;