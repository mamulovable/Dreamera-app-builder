CREATE TYPE "public"."backend_state" AS ENUM('linked', 'provisioning', 'ready', 'failed', 'disconnected');--> statement-breakpoint
CREATE TABLE "cloudhike_connections" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"access_token" text NOT NULL,
	"mcp_url" text NOT NULL,
	"api_url" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_backends" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"state" "backend_state" DEFAULT 'linked' NOT NULL,
	"cloudhike_project_id" text,
	"cloudhike_project_slug" text,
	"services" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"environment" text,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cloudhike_connections" ADD CONSTRAINT "cloudhike_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_backends" ADD CONSTRAINT "project_backends_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;