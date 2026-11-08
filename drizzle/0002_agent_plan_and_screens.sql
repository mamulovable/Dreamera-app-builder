CREATE TYPE "public"."screen_layout" AS ENUM('home', 'list', 'detail', 'profile');--> statement-breakpoint
CREATE TYPE "public"."screen_status" AS ENUM('pending', 'generating', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "screens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"status" "screen_status" DEFAULT 'pending' NOT NULL,
	"layout" "screen_layout" DEFAULT 'home' NOT NULL,
	"file_path" text NOT NULL,
	"code" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "plan" jsonb;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "plan" jsonb;--> statement-breakpoint
ALTER TABLE "screens" ADD CONSTRAINT "screens_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "screens_project_id_idx" ON "screens" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "screens_project_slug_idx" ON "screens" USING btree ("project_id","slug");