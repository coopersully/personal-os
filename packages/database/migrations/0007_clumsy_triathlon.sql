ALTER TABLE "reminders" ADD COLUMN "kind" text DEFAULT 'reminder' NOT NULL;--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "status" text DEFAULT 'inbox' NOT NULL;--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "estimate_minutes" integer;--> statement-breakpoint
CREATE INDEX "reminders_user_task_idx" ON "reminders" USING btree ("user_id","kind","status","scheduled_at");