CREATE TABLE IF NOT EXISTS "billing_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" integer NOT NULL,
	"reference" text NOT NULL,
	"order_no" text,
	"amount" integer NOT NULL,
	"currency" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"paid_at" timestamp,
	CONSTRAINT "billing_payments_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_payments" ADD CONSTRAINT "billing_payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_payments_user_id_idx" ON "billing_payments" USING btree ("user_id");
