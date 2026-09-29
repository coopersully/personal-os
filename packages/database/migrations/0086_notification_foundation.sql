CREATE TABLE "notification_attempt_items" (
	"user_id" uuid NOT NULL,
	"attempt_id" uuid NOT NULL,
	"intent_id" uuid NOT NULL,
	"work" jsonb NOT NULL,
	CONSTRAINT "notification_attempt_items_ref_check" CHECK (COALESCE(jsonb_typeof("notification_attempt_items"."work") = 'object'
    AND "notification_attempt_items"."work" ?& ARRAY['id','domain','kind','revision','actionRevision']
    AND ("notification_attempt_items"."work" - ARRAY['id','domain','kind','revision','actionRevision']) = '{}'::jsonb
    AND "notification_attempt_items"."work"->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND "notification_attempt_items"."work"->>'domain' = 'finances'
    AND "notification_attempt_items"."work"->>'kind' IN ('question','approval','repair')
    AND jsonb_typeof("notification_attempt_items"."work"->'revision') = 'string'
    AND char_length(btrim("notification_attempt_items"."work"->>'revision')) BETWEEN 1 AND 200
    AND jsonb_typeof("notification_attempt_items"."work"->'actionRevision') = 'string'
    AND char_length(btrim("notification_attempt_items"."work"->>'actionRevision')) BETWEEN 1 AND 200, false))
);
--> statement-breakpoint
CREATE TABLE "notification_delivery_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"state" text NOT NULL,
	"reason" text,
	"claim_id" uuid NOT NULL,
	"generation" integer DEFAULT 1 NOT NULL,
	"lease_until" timestamp with time zone NOT NULL,
	"connection_id" uuid,
	"consent_epoch" integer,
	"message_id" uuid,
	"time_zone" text,
	"timezone_revision" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_attempts_generation_check" CHECK ("notification_delivery_attempts"."generation" > 0 AND "notification_delivery_attempts"."consent_epoch" > 0),
	CONSTRAINT "notification_attempts_connection_check" CHECK ("notification_delivery_attempts"."connection_id" IS NOT NULL AND "notification_delivery_attempts"."consent_epoch" IS NOT NULL),
	CONSTRAINT "notification_attempts_state_check" CHECK ("notification_delivery_attempts"."state" IN ('claimed','submitting','accepted','uncertain','failed','suppressed')),
	CONSTRAINT "notification_attempts_submission_check" CHECK ("notification_delivery_attempts"."state" IN ('claimed','suppressed') OR ("notification_delivery_attempts"."message_id" IS NOT NULL AND "notification_delivery_attempts"."connection_id" IS NOT NULL AND "notification_delivery_attempts"."consent_epoch" IS NOT NULL AND "notification_delivery_attempts"."submitted_at" IS NOT NULL AND "notification_delivery_attempts"."time_zone" IS NOT NULL AND "notification_delivery_attempts"."timezone_revision" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "notification_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"work_id" uuid NOT NULL,
	"work" jsonb NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_intents_work_check" CHECK ("notification_intents"."domain" = 'finances' AND "notification_intents"."work"->>'domain' = "notification_intents"."domain" AND "notification_intents"."work"->>'id' = "notification_intents"."work_id"::text),
	CONSTRAINT "notification_intents_state_check" CHECK ("notification_intents"."state" IN ('pending','deferred','blocked','resolved')),
	CONSTRAINT "notification_intents_ref_check" CHECK (COALESCE(jsonb_typeof("notification_intents"."work") = 'object'
    AND "notification_intents"."work" ?& ARRAY['id','domain','kind','revision','actionRevision']
    AND ("notification_intents"."work" - ARRAY['id','domain','kind','revision','actionRevision']) = '{}'::jsonb
    AND "notification_intents"."work"->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND "notification_intents"."work"->>'domain' = 'finances'
    AND "notification_intents"."work"->>'kind' IN ('question','approval','repair')
    AND jsonb_typeof("notification_intents"."work"->'revision') = 'string'
    AND char_length(btrim("notification_intents"."work"->>'revision')) BETWEEN 1 AND 200
    AND jsonb_typeof("notification_intents"."work"->'actionRevision') = 'string'
    AND char_length(btrim("notification_intents"."work"->>'actionRevision')) BETWEEN 1 AND 200, false))
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"revision" integer NOT NULL,
	"preferences" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_scope_check" CHECK ("notification_preferences"."scope" IN ('global', 'finances')),
	CONSTRAINT "notification_preferences_revision_check" CHECK ("notification_preferences"."revision" > 0),
	CONSTRAINT "notification_preferences_value_check" CHECK (COALESCE(
    jsonb_typeof("notification_preferences"."preferences") = 'object'
    AND "notification_preferences"."preferences" ?& ARRAY['enabled','quietMode','quietStartMinute','quietEndMinute','reminderDays','detail']
    AND ("notification_preferences"."preferences" - ARRAY['enabled','quietMode','quietStartMinute','quietEndMinute','reminderDays','detail']) = '{}'::jsonb
    AND jsonb_typeof("notification_preferences"."preferences"->'enabled') = 'boolean'
    AND "notification_preferences"."preferences"->>'quietMode' IN ('window','any_time')
    AND "notification_preferences"."preferences"->>'detail' IN ('minimal','context')
    AND ("notification_preferences"."preferences"->>'quietStartMinute')::numeric BETWEEN 0 AND 1439
    AND mod(("notification_preferences"."preferences"->>'quietStartMinute')::numeric, 1) = 0
    AND jsonb_typeof("notification_preferences"."preferences"->'quietStartMinute') = 'number'
    AND ("notification_preferences"."preferences"->>'quietEndMinute')::numeric BETWEEN 0 AND 1439
    AND mod(("notification_preferences"."preferences"->>'quietEndMinute')::numeric, 1) = 0
    AND jsonb_typeof("notification_preferences"."preferences"->'quietEndMinute') = 'number'
    AND ("notification_preferences"."preferences"->>'quietMode' = 'any_time' OR "notification_preferences"."preferences"->>'quietStartMinute' <> "notification_preferences"."preferences"->>'quietEndMinute')
    AND ("notification_preferences"."preferences"->'reminderDays' = 'null'::jsonb OR
      (jsonb_typeof("notification_preferences"."preferences"->'reminderDays') = 'number' AND ("notification_preferences"."preferences"->>'reminderDays')::numeric BETWEEN 1 AND 365 AND mod(("notification_preferences"."preferences"->>'reminderDays')::numeric, 1) = 0)), false))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_attempt_items_idx" ON "notification_attempt_items" USING btree ("attempt_id","intent_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_attempts_owner_id_idx" ON "notification_delivery_attempts" USING btree ("user_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_attempts_message_idx" ON "notification_delivery_attempts" USING btree ("message_id");
--> statement-breakpoint
CREATE INDEX "notification_attempts_due_idx" ON "notification_delivery_attempts" USING btree ("user_id","state","lease_until");
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_intents_owner_id_idx" ON "notification_intents" USING btree ("user_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_intents_work_idx" ON "notification_intents" USING btree ("user_id","domain","work_id");
--> statement-breakpoint
CREATE INDEX "notification_intents_owner_state_idx" ON "notification_intents" USING btree ("user_id","state");
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_preferences_owner_scope_idx" ON "notification_preferences" USING btree ("user_id","scope");
--> statement-breakpoint
CREATE UNIQUE INDEX "text_messages_owner_id_idx" ON "text_messages" USING btree ("user_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "texting_connections_owner_id_idx" ON "texting_connections" USING btree ("user_id","id");
--> statement-breakpoint
ALTER TABLE "notification_attempt_items" ADD CONSTRAINT "notification_attempt_items_user_id_attempt_id_notification_delivery_attempts_user_id_id_fk" FOREIGN KEY ("user_id","attempt_id") REFERENCES "public"."notification_delivery_attempts"("user_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notification_attempt_items" ADD CONSTRAINT "notification_attempt_items_user_id_intent_id_notification_intents_user_id_id_fk" FOREIGN KEY ("user_id","intent_id") REFERENCES "public"."notification_intents"("user_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notification_delivery_attempts" ADD CONSTRAINT "notification_delivery_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notification_delivery_attempts" ADD CONSTRAINT "notification_delivery_attempts_user_id_connection_id_texting_connections_user_id_id_fk" FOREIGN KEY ("user_id","connection_id") REFERENCES "public"."texting_connections"("user_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notification_delivery_attempts" ADD CONSTRAINT "notification_delivery_attempts_user_id_message_id_text_messages_user_id_id_fk" FOREIGN KEY ("user_id","message_id") REFERENCES "public"."text_messages"("user_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notification_intents" ADD CONSTRAINT "notification_intents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Hard cutover of application provenance only; historical bodies and provider evidence are unchanged.
UPDATE text_messages SET occurred_at_source = 'nohmi' WHERE occurred_at_source = 'ilo';
--> statement-breakpoint
UPDATE texting_consent_events SET source = 'nohmi' WHERE source = 'ilo';
