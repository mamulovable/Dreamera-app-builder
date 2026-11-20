DO $$ BEGIN
  CREATE TYPE "public"."ai_call_task" AS ENUM('text', 'transcribe', 'vision');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."ai_call_status" AS ENUM('succeeded', 'failed', 'blocked');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_calls" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" integer,
  "project_id" uuid,
  "user_email" text NOT NULL,
  "project_title" text NOT NULL,
  "task" "ai_call_task" NOT NULL,
  "model" text,
  "status" "ai_call_status" NOT NULL,
  "credits" integer DEFAULT 0 NOT NULL,
  "refunded" boolean DEFAULT false NOT NULL,
  "prompt_tokens" integer,
  "completion_tokens" integer,
  "total_tokens" integer,
  "audio_seconds" double precision,
  "input_preview" text,
  "output_preview" text,
  "input_bytes" integer,
  "error" text,
  "duration_ms" integer,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_calls_created_at_idx" ON "ai_calls" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_calls_user_id_idx" ON "ai_calls" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_calls_project_id_idx" ON "ai_calls" USING btree ("project_id");
