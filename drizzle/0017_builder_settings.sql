CREATE TABLE IF NOT EXISTS "builder_settings" (
  "id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
  "primary_provider" text DEFAULT 'cloudhike' NOT NULL,
  "cloudhike_planner_model" text,
  "cloudhike_builder_model" text,
  "gemini_planner_model" text,
  "gemini_builder_model" text,
  "updated_by" integer,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "builder_settings" ADD CONSTRAINT "builder_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TYPE "public"."admin_audit_action" ADD VALUE IF NOT EXISTS 'set-builder';
