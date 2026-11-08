CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"auth_user_id" text NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"credits" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_auth_user_id_unique" UNIQUE("auth_user_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
