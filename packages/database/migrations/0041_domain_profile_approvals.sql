-- Before approval snapshots existed, an agent could persist an active Finance
-- profile. There is no durable signed-in-user provenance to backfill, so keep
-- the content as a reviewable draft instead of treating it as operative.
UPDATE "domain_profiles"
SET
	"status" = 'draft',
	"version" = "version" + 1,
	"updated_at" = now()
WHERE "domain" = 'finances' AND "status" = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX "domain_profiles_id_user_domain_idx"
	ON "domain_profiles" USING btree ("id","user_id","domain");
--> statement-breakpoint
CREATE TABLE "domain_profile_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"profile_id" uuid NOT NULL,
	"profile_version" integer NOT NULL,
	"profile" jsonb NOT NULL,
	"approved_by_user_id" uuid NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domain_profile_approvals_user_id_users_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade,
	CONSTRAINT "domain_profile_approvals_approved_by_user_id_users_id_fk"
		FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade,
	CONSTRAINT "domain_profile_approvals_owned_profile_fk"
		FOREIGN KEY ("profile_id","user_id","domain")
		REFERENCES "public"."domain_profiles"("id","user_id","domain") ON DELETE cascade,
	CONSTRAINT "domain_profile_approvals_owner_check"
		CHECK ("approved_by_user_id" = "user_id"),
	CONSTRAINT "domain_profile_approvals_snapshot_check"
		CHECK (
			"profile"->>'id' = "profile_id"::text
			AND "profile"->>'domain' = "domain"
			AND ("profile"->>'version')::integer = "profile_version"
			AND "profile"->>'status' = 'active'
		)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "domain_profile_approvals_user_domain_idx"
	ON "domain_profile_approvals" USING btree ("user_id","domain");
--> statement-breakpoint
CREATE INDEX "domain_profile_approvals_profile_idx"
	ON "domain_profile_approvals" USING btree ("profile_id");
