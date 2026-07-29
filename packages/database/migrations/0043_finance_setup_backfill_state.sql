CREATE TABLE "finance_setup_backfill_state" (
	"key" text PRIMARY KEY NOT NULL,
	"categories_complete" boolean DEFAULT false NOT NULL,
	"profile_cursor" uuid,
	"profiles_complete" boolean DEFAULT false NOT NULL,
	"user_cursor" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
