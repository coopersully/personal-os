ALTER TABLE "calendar_accounts"
	ADD COLUMN "sync_generation" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "calendar_accounts"
	ADD COLUMN "sync_claim_id" uuid;
--> statement-breakpoint
UPDATE "calendar_accounts"
SET
	"sync_error" = 'Synchronization interrupted by connector lifecycle upgrade.',
	"sync_status" = 'error',
	"updated_at" = now()
WHERE "sync_status" = 'syncing';
--> statement-breakpoint
ALTER TABLE "calendar_accounts"
	ADD CONSTRAINT "calendar_accounts_sync_generation_check"
	CHECK ("sync_generation" >= 0);
--> statement-breakpoint
ALTER TABLE "calendar_accounts"
	ADD CONSTRAINT "calendar_accounts_sync_claim_check"
	CHECK (
		("sync_status" = 'syncing')
		= ("sync_claim_id" IS NOT NULL)
	);
