CREATE TABLE "domain_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"objective" text NOT NULL,
	"summary" text NOT NULL,
	"instructions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_contexts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"categories" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domain_profiles_user_id_users_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX "domain_profiles_user_domain_idx"
	ON "domain_profiles" USING btree ("user_id","domain");
--> statement-breakpoint
CREATE INDEX "domain_profiles_user_status_idx"
	ON "domain_profiles" USING btree ("user_id","status");
--> statement-breakpoint
CREATE TABLE "attention_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"kind" text NOT NULL,
	"importance" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"occurs_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"source" jsonb,
	"related_entity_type" text,
	"related_entity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attention_items_user_id_users_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX "attention_items_user_domain_status_idx"
	ON "attention_items" USING btree ("user_id","domain","status","created_at");
--> statement-breakpoint
CREATE INDEX "attention_items_user_occurs_idx"
	ON "attention_items" USING btree ("user_id","occurs_at");
--> statement-breakpoint
ALTER TABLE "mail_rules" ADD COLUMN "profile_id" uuid;
--> statement-breakpoint
ALTER TABLE "mail_rules" ADD COLUMN "description" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "mail_rules" ADD COLUMN "condition" jsonb;
--> statement-breakpoint
ALTER TABLE "mail_rules" ADD COLUMN "actions" jsonb;
--> statement-breakpoint
ALTER TABLE "mail_rules" ADD COLUMN "source_account_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "mail_rules" ADD COLUMN "confidence_threshold_basis_points" integer;
--> statement-breakpoint
ALTER TABLE "mail_rules" ADD COLUMN "policy" text DEFAULT 'preview' NOT NULL;
--> statement-breakpoint
ALTER TABLE "mail_rules" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "mail_rules" ALTER COLUMN "query" SET DEFAULT '__ilo_rule_v2__';
--> statement-breakpoint
ALTER TABLE "mail_rules" ALTER COLUMN "action" SET DEFAULT 'archive';
--> statement-breakpoint
UPDATE "mail_rules"
SET
	"condition" = jsonb_build_object(
		'field', 'any',
		'operator', 'contains',
		'value', "query"
	),
	"actions" = jsonb_build_array(
		jsonb_build_object(
			'type', "action",
			'afterDays', 0,
			'mailboxId', NULL
		)
	);
--> statement-breakpoint
UPDATE "mail_rules"
SET "policy" = CASE WHEN "enabled" THEN 'approved_rule' ELSE 'preview' END;
--> statement-breakpoint
ALTER TABLE "mail_rules" ALTER COLUMN "enabled" SET DEFAULT false;
--> statement-breakpoint
ALTER TABLE "mail_rules" ADD CONSTRAINT "mail_rules_profile_id_domain_profiles_id_fk"
	FOREIGN KEY ("profile_id") REFERENCES "public"."domain_profiles"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX "mail_rules_user_enabled_idx" ON "mail_rules" USING btree ("user_id","enabled");
