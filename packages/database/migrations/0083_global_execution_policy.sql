CREATE TABLE "execution_policy_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"review_bypass_enabled" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "execution_policy_settings_version_check" CHECK ("execution_policy_settings"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "execution_policy_settings" ADD CONSTRAINT "execution_policy_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Preserve every previously granted Finance bypass during the hard cutover. If the two
-- legacy controls drifted, the safer compatibility rule is to retain an explicit grant.
INSERT INTO "execution_policy_settings" (
	"user_id",
	"review_bypass_enabled",
	"version",
	"created_at",
	"updated_at"
)
SELECT
	"legacy"."user_id",
	bool_or("legacy"."review_bypass_enabled"),
	1,
	min("legacy"."created_at"),
	max("legacy"."updated_at")
FROM (
	SELECT "user_id", "review_bypass_enabled", "created_at", "updated_at"
	FROM "finance_automation_settings"
	UNION ALL
	SELECT "user_id", "review_bypass_enabled", "created_at", "updated_at"
	FROM "finance_agent_settings"
) AS "legacy"
GROUP BY "legacy"."user_id";
