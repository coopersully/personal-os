ALTER TABLE "mailboxes" ADD COLUMN "provider_revision" text;
--> statement-breakpoint
DELETE FROM "mail_calendar_commitment_intakes" AS "intake"
USING "calendar_accounts" AS "account"
WHERE "intake"."account_id" = "account"."id"
	AND "account"."provider" = 'icloud';
--> statement-breakpoint
DELETE FROM "mail_threads" AS "thread"
USING "calendar_accounts" AS "account"
WHERE "thread"."account_id" = "account"."id"
	AND "account"."provider" = 'icloud';
