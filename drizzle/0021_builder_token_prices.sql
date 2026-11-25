ALTER TABLE "builder_settings" ADD COLUMN IF NOT EXISTS "input_price_per_million" double precision DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "builder_settings" ADD COLUMN IF NOT EXISTS "output_price_per_million" double precision DEFAULT 0 NOT NULL;
