ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "ai_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TYPE "public"."credit_reason" ADD VALUE IF NOT EXISTS 'ai';
