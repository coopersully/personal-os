ALTER TABLE "texting_verification_challenges" ALTER COLUMN "provider_verification_sid" DROP NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "texting_consent_provider_event_idx" ON "texting_consent_events" USING btree ("provider_event_id") WHERE "provider_event_id" IS NOT NULL;
