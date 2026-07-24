ALTER TABLE "users" ADD COLUMN "workday_start_minute" integer DEFAULT 540 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "workday_end_minute" integer DEFAULT 1020 NOT NULL;