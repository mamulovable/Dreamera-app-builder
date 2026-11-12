ALTER TYPE "public"."project_platform" ADD VALUE IF NOT EXISTS 'web';--> statement-breakpoint
ALTER TYPE "public"."screen_layout" ADD VALUE IF NOT EXISTS 'landing';--> statement-breakpoint
ALTER TYPE "public"."screen_layout" ADD VALUE IF NOT EXISTS 'content';--> statement-breakpoint
ALTER TYPE "public"."screen_layout" ADD VALUE IF NOT EXISTS 'dashboard';
