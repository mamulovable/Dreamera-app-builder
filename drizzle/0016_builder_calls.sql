CREATE TABLE IF NOT EXISTS "builder_calls" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" integer,
  "project_id" uuid,
  "user_email" text NOT NULL,
  "project_title" text NOT NULL,
  "kind" text NOT NULL,
  "label" text NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "status" text NOT NULL,
  "input_tokens" integer DEFAULT 0 NOT NULL,
  "cached_input_tokens" integer DEFAULT 0 NOT NULL,
  "output_tokens" integer DEFAULT 0 NOT NULL,
  "total_tokens" integer DEFAULT 0 NOT NULL,
  "error" text,
  "duration_ms" integer,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "builder_calls" ADD CONSTRAINT "builder_calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "builder_calls" ADD CONSTRAINT "builder_calls_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "builder_calls_created_at_idx" ON "builder_calls" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "builder_calls_project_id_idx" ON "builder_calls" USING btree ("project_id");
