CREATE TABLE "finance_automation_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"review_bypass_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "finance_automation_settings" ADD CONSTRAINT "finance_automation_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
