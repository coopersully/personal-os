ALTER TABLE "mail_calendar_commitment_intakes"
	RENAME COLUMN "authenticated_account_address_hash" TO "provider_account_address_hint_hash";
--> statement-breakpoint
ALTER TABLE "mail_calendar_commitment_intakes"
	RENAME CONSTRAINT "mail_calendar_commitment_intake_account_address_hash_check"
	TO "mail_calendar_commitment_intake_account_address_hint_hash_check";
--> statement-breakpoint
DELETE FROM "mail_calendar_commitment_intakes" AS "intake"
USING "calendar_accounts" AS "account"
WHERE "intake"."account_id" = "account"."id"
	AND "account"."provider" = 'icloud';
--> statement-breakpoint
DELETE FROM "mail_messages" AS "message"
USING "mail_threads" AS "thread", "calendar_accounts" AS "account"
WHERE "message"."thread_id" = "thread"."id"
	AND "thread"."account_id" = "account"."id"
	AND "account"."provider" = 'icloud';
--> statement-breakpoint
ALTER TABLE "mail_calendar_commitment_intakes"
	ADD CONSTRAINT "mail_calendar_commitment_intake_authority_status_check"
	CHECK (
		"authority" <> 'provider_projected_unverified'
		OR "status" = 'preview_only'
	);
