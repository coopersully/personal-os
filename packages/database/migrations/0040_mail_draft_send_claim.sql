ALTER TABLE "mail_drafts"
	ADD COLUMN "send_claimed_at" timestamp with time zone,
	ADD COLUMN "send_claim_id" uuid,
	ADD COLUMN "send_status" text DEFAULT 'draft' NOT NULL;
--> statement-breakpoint
UPDATE "mail_drafts"
SET "send_status" = 'sent'
WHERE "sent_at" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "mail_drafts"
	ADD CONSTRAINT "mail_drafts_send_state_check"
	CHECK (
		(
			"send_status" = 'draft'
			AND "sent_at" IS NULL
			AND "send_claim_id" IS NULL
			AND "send_claimed_at" IS NULL
		)
		OR (
			"send_status" = 'sending'
			AND "sent_at" IS NULL
			AND "send_claim_id" IS NOT NULL
			AND "send_claimed_at" IS NOT NULL
		)
		OR (
			"send_status" = 'reconcile'
			AND "sent_at" IS NULL
			AND "send_claim_id" IS NOT NULL
			AND "send_claimed_at" IS NOT NULL
		)
		OR (
			"send_status" = 'sent'
			AND "sent_at" IS NOT NULL
			AND "send_claim_id" IS NULL
			AND "send_claimed_at" IS NULL
		)
	);
