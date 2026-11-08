CREATE TYPE "public"."build_status" AS ENUM('active', 'finished');--> statement-breakpoint
CREATE TABLE "build_events" (
	"build_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"event" jsonb NOT NULL,
	CONSTRAINT "build_events_build_id_seq_pk" PRIMARY KEY("build_id","seq")
);
--> statement-breakpoint
CREATE TABLE "builds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"status" "build_status" DEFAULT 'active' NOT NULL,
	"job_id" text,
	"step" integer DEFAULT 1 NOT NULL,
	"lease" uuid,
	"last_seq" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "build_events" ADD CONSTRAINT "build_events_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builds" ADD CONSTRAINT "builds_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "builds_one_active_idx" ON "builds" USING btree ("project_id") WHERE status = 'active';