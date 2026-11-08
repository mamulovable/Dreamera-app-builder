ALTER TABLE "messages" ADD COLUMN "handled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "archived" boolean DEFAULT false NOT NULL;