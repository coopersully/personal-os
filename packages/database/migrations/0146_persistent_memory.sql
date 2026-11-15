-- from branch 0130_persistent_knowledge.sql
CREATE TABLE knowledge_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 revision integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT knowledge_records_owner_id_idx UNIQUE(user_id,id)
);
--> statement-breakpoint
CREATE TABLE knowledge_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, record_id uuid NOT NULL, revision integer NOT NULL,
 snapshot jsonb NOT NULL,
 CONSTRAINT knowledge_revisions_owner_record_revision_idx UNIQUE(user_id,record_id,revision),
 FOREIGN KEY(user_id,record_id) REFERENCES knowledge_records(user_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE knowledge_sources (
 id uuid PRIMARY KEY, user_id uuid NOT NULL, record_id uuid NOT NULL, source jsonb NOT NULL,
 FOREIGN KEY(user_id,record_id) REFERENCES knowledge_records(user_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE knowledge_relationships (
 user_id uuid NOT NULL, record_id uuid NOT NULL, related_record_id uuid NOT NULL,
 CONSTRAINT knowledge_relationships_pair_idx UNIQUE(user_id,record_id,related_record_id),
 FOREIGN KEY(user_id,record_id) REFERENCES knowledge_records(user_id,id) ON DELETE CASCADE,
 FOREIGN KEY(user_id,related_record_id) REFERENCES knowledge_records(user_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE knowledge_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, record_id uuid NOT NULL,
 mutation_key uuid NOT NULL, request_hash text NOT NULL,
 CONSTRAINT knowledge_receipts_owner_key_idx UNIQUE(user_id,mutation_key),
 FOREIGN KEY(user_id,record_id) REFERENCES knowledge_records(user_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
-- from branch 0140_knowledge_lifecycle.sql
ALTER TABLE "knowledge_receipts" ADD COLUMN "private_proposal" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE TABLE "knowledge_revision_metadata" (
  "user_id" uuid NOT NULL,
  "record_id" uuid NOT NULL,
  "revision" integer NOT NULL,
  "claim_key" text,
  "metadata" jsonb NOT NULL,
  PRIMARY KEY ("user_id", "record_id", "revision"),
  CONSTRAINT "knowledge_revision_metadata_revision_fk" FOREIGN KEY ("user_id", "record_id", "revision")
    REFERENCES "knowledge_revisions" ("user_id", "record_id", "revision") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "knowledge_revision_metadata_owner_claim_idx" ON "knowledge_revision_metadata" ("user_id", md5("claim_key"));
--> statement-breakpoint
CREATE TABLE "knowledge_owner_epochs" (
  "user_id" uuid PRIMARY KEY REFERENCES "users" ("id") ON DELETE CASCADE,
  "epoch" bigint NOT NULL,
  CONSTRAINT "knowledge_owner_epochs_positive" CHECK ("epoch" > 0)
);
--> statement-breakpoint
CREATE TABLE "knowledge_derivations" (
  "user_id" uuid NOT NULL,
  "record_id" uuid NOT NULL,
  "revision" integer NOT NULL,
  "source_record_id" uuid NOT NULL,
  "source_revision" integer NOT NULL,
  "kind" text NOT NULL,
  PRIMARY KEY ("user_id", "record_id", "revision", "source_record_id", "source_revision", "kind"),
  CONSTRAINT "knowledge_derivations_revision_fk" FOREIGN KEY ("user_id", "record_id", "revision")
    REFERENCES "knowledge_revisions" ("user_id", "record_id", "revision") ON DELETE CASCADE,
  CONSTRAINT "knowledge_derivations_source_revision_fk" FOREIGN KEY ("user_id", "source_record_id", "source_revision")
    REFERENCES "knowledge_revisions" ("user_id", "record_id", "revision") ON DELETE CASCADE,
  CONSTRAINT "knowledge_derivations_kind_check" CHECK ("kind" IN ('source_record', 'entity_meaning', 'content_evidence', 'revision_proposal')),
  CONSTRAINT "knowledge_derivations_no_self" CHECK ("record_id" <> "source_record_id")
);
--> statement-breakpoint
CREATE INDEX "knowledge_derivations_owner_source_idx" ON "knowledge_derivations" ("user_id", "source_record_id");
--> statement-breakpoint
-- Source-domain deletions invalidate cursor epochs independently of the contributing credential.
CREATE FUNCTION knowledge_invalidate_external_source() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO public.knowledge_owner_epochs (user_id, epoch)
    SELECT owner.id, 1 FROM public.users owner WHERE owner.id = OLD.user_id
      AND EXISTS (SELECT 1 FROM public.knowledge_records r WHERE r.user_id = OLD.user_id)
    ON CONFLICT (user_id) DO UPDATE SET epoch = public.knowledge_owner_epochs.epoch + 1;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER knowledge_invalidate_signed_source AFTER DELETE ON "text_inbound_claims"
  FOR EACH ROW EXECUTE FUNCTION knowledge_invalidate_external_source();
--> statement-breakpoint
CREATE TRIGGER knowledge_invalidate_goal_source AFTER DELETE ON "goals"
  FOR EACH ROW EXECUTE FUNCTION knowledge_invalidate_external_source();
--> statement-breakpoint
-- from branch 0142_knowledge_forgetting.sql
ALTER TABLE "knowledge_receipts" ALTER COLUMN "request_hash" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "knowledge_receipts" ADD COLUMN "actor_id" uuid;
--> statement-breakpoint
CREATE TABLE "knowledge_forget_operations" (
  "id" uuid PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "record_id" uuid NOT NULL,
  "preview_id" uuid NOT NULL,
  "epoch" bigint NOT NULL,
  "mutation_key" uuid NOT NULL,
  "status" text NOT NULL,
  "phase" text NOT NULL,
  "scrub_cursor" uuid,
  "key_proof" text NOT NULL,
  "suppression_fingerprints" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "failures" integer DEFAULT 0 NOT NULL,
  "due_at" timestamptz NOT NULL,
  "lease_id" uuid,
  "lease_until" timestamptz,
  CONSTRAINT "knowledge_forget_operations_status" CHECK ("status" IN ('pending', 'blocked', 'completed')),
  CONSTRAINT "knowledge_forget_operations_phase" CHECK ("phase" IN ('plan', 'erase', 'scrub', 'ledger')),
  CONSTRAINT "knowledge_forget_operations_lease" CHECK (("lease_id" IS NULL) = ("lease_until" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_forget_operations_owner_id_idx" ON "knowledge_forget_operations" ("user_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_forget_operations_owner_key_idx" ON "knowledge_forget_operations" ("user_id", "mutation_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_forget_operations_active_owner_idx" ON "knowledge_forget_operations" ("user_id") WHERE "status" <> 'completed';
--> statement-breakpoint
CREATE INDEX "knowledge_forget_operations_due_idx" ON "knowledge_forget_operations" ("due_at", "id") WHERE "status" = 'pending';
--> statement-breakpoint
CREATE TABLE "knowledge_forget_targets" (
  "user_id" uuid NOT NULL,
  "operation_id" uuid NOT NULL,
  "record_id" uuid NOT NULL,
  "erased" boolean DEFAULT false NOT NULL,
  PRIMARY KEY ("user_id", "record_id"),
  CONSTRAINT "knowledge_forget_targets_operation_fk" FOREIGN KEY ("user_id", "operation_id")
    REFERENCES "knowledge_forget_operations" ("user_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "knowledge_forget_targets_work_idx" ON "knowledge_forget_targets" ("user_id", "operation_id", "erased", "record_id");
--> statement-breakpoint
CREATE TABLE "knowledge_forget_previews" (
  "id" uuid PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "record_id" uuid NOT NULL,
  "epoch" bigint NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_forget_previews_owner_record_idx" ON "knowledge_forget_previews" ("user_id", "record_id");
--> statement-breakpoint
CREATE TABLE "knowledge_forget_suppressions" (
  "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "fingerprint" text NOT NULL,
  "key_proof" text NOT NULL,
  PRIMARY KEY ("user_id", "fingerprint")
);
--> statement-breakpoint
-- from branch 0143_knowledge_forget_replay.sql
ALTER TABLE "knowledge_receipts" ADD COLUMN "replay_verifier" text;
--> statement-breakpoint
CREATE TABLE "knowledge_forget_replay_bindings" (
  "user_id" uuid NOT NULL,
  "mutation_key" uuid NOT NULL,
  "preview_id" uuid NOT NULL,
  "owner_epoch" bigint NOT NULL,
  "operation_id" uuid NOT NULL,
  "record_id" uuid NOT NULL,
  PRIMARY KEY ("user_id", "mutation_key"),
  CONSTRAINT "knowledge_forget_replay_bindings_operation_fk" FOREIGN KEY ("user_id", "operation_id")
    REFERENCES "knowledge_forget_operations" ("user_id", "id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "knowledge_forget_replay_bindings_operation_idx"
  ON "knowledge_forget_replay_bindings" ("user_id", "operation_id");
--> statement-breakpoint
-- from branch 0144_knowledge_context_receipts.sql
CREATE TABLE "knowledge_context_uses" (
  "id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "actor_id" uuid NOT NULL,
  "actor_type" text NOT NULL,
  "purpose" text NOT NULL,
  "workspace" text,
  "epoch" integer NOT NULL,
  "references" jsonb NOT NULL,
  "created_at" timestamp with time zone NOT NULL,
  CONSTRAINT "knowledge_context_uses_actor_check" CHECK ("actor_type" IN ('user', 'agent')),
  CONSTRAINT "knowledge_context_uses_purpose_check" CHECK ("purpose" IN ('setup', 'bookkeeping', 'planning', 'review', 'communication', 'recovery')),
  CONSTRAINT "knowledge_context_uses_workspace_check" CHECK ("workspace" IN ('tasks', 'calendar', 'mail', 'finances')),
  CONSTRAINT "knowledge_context_uses_epoch_check" CHECK ("epoch" >= 0),
  CONSTRAINT "knowledge_context_uses_refs_check" CHECK (jsonb_typeof("references") = 'array' AND jsonb_array_length("references") <= 50)
);
--> statement-breakpoint
CREATE INDEX "knowledge_context_uses_owner_idx" ON "knowledge_context_uses" ("user_id");
--> statement-breakpoint
-- from branch 0145_knowledge_context_selection_refs.sql
ALTER TABLE "knowledge_context_uses"
  ALTER COLUMN "epoch" TYPE bigint;
