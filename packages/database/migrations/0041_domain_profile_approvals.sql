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
	CONSTRAINT "domain_profile_approvals_profile_id_domain_profiles_id_fk"
		FOREIGN KEY ("profile_id") REFERENCES "public"."domain_profiles"("id") ON DELETE cascade,
	CONSTRAINT "domain_profile_approvals_approved_by_user_id_users_id_fk"
		FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX "domain_profile_approvals_user_domain_idx"
	ON "domain_profile_approvals" USING btree ("user_id","domain");
--> statement-breakpoint
CREATE INDEX "domain_profile_approvals_profile_idx"
	ON "domain_profile_approvals" USING btree ("profile_id");
