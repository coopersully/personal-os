CREATE TABLE "calendar_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"summary" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"source_references" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_cutoff" timestamp with time zone NOT NULL,
	"playbook_version" text NOT NULL,
	"rulebook_version" text NOT NULL,
	"first_observed_at" timestamp with time zone NOT NULL,
	"last_observed_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_findings_fingerprint_check" CHECK ("fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "calendar_findings_status_check" CHECK ("status" IN ('open', 'resolved')),
	CONSTRAINT "calendar_findings_resolution_check" CHECK (("status" = 'resolved') = ("resolved_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "calendar_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"state" text NOT NULL,
	"scope" jsonb NOT NULL,
	"scope_start" timestamp with time zone NOT NULL,
	"scope_end" timestamp with time zone NOT NULL,
	"evidence_cutoff" timestamp with time zone NOT NULL,
	"next_maintenance_at" timestamp with time zone NOT NULL,
	"playbook_version" text NOT NULL,
	"rulebook_version" text NOT NULL,
	"profile_version" integer,
	"ledger_fingerprint" text NOT NULL,
	"source_freshness" jsonb NOT NULL,
	"health" jsonb NOT NULL,
	"finding_snapshots" jsonb NOT NULL,
	"recommendations" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_reviews_fingerprint_check" CHECK ("ledger_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "calendar_reviews_state_check" CHECK ("state" IN ('maintained', 'maintained_with_questions', 'blocked')),
	CONSTRAINT "calendar_reviews_scope_check" CHECK ("scope_start" <= "evidence_cutoff" AND "evidence_cutoff" <= "scope_end")
);
--> statement-breakpoint
ALTER TABLE "calendar_findings" ADD CONSTRAINT "calendar_findings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "calendar_reviews" ADD CONSTRAINT "calendar_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_findings_identity_idx" ON "calendar_findings" USING btree ("user_id", "fingerprint");
--> statement-breakpoint
CREATE INDEX "calendar_findings_user_status_idx" ON "calendar_findings" USING btree ("user_id", "status", "last_observed_at");
--> statement-breakpoint
CREATE INDEX "calendar_reviews_user_created_idx" ON "calendar_reviews" USING btree ("user_id", "created_at");
