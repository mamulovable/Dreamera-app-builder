ALTER TABLE "projects" ADD COLUMN "is_public" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "projects_public_idx" ON "projects" USING btree ("id") WHERE is_public;