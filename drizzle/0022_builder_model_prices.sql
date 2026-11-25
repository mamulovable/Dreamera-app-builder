ALTER TABLE "builder_settings" ADD COLUMN IF NOT EXISTS "model_prices" jsonb DEFAULT '{}'::jsonb NOT NULL;
