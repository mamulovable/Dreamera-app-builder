ALTER TABLE "builder_settings" ADD COLUMN IF NOT EXISTS "openrouter_planner_model" text;
--> statement-breakpoint
ALTER TABLE "builder_settings" ADD COLUMN IF NOT EXISTS "openrouter_builder_model" text;
