-- from branch 0130_persistent_knowledge.sql
CREATE TABLE knowledge_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 revision integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
 trashed_at timestamptz NULL, trash_group_id uuid NULL, status_before_trash text NULL,
 owner_held boolean NOT NULL DEFAULT false, agent_access text NOT NULL DEFAULT 'allowed',
 core boolean NOT NULL DEFAULT false, last_confirmed_at timestamptz NULL,
 CONSTRAINT knowledge_records_owner_id_idx UNIQUE(user_id,id),
 CONSTRAINT knowledge_records_agent_access CHECK (agent_access IN ('allowed', 'blocked')),
 CONSTRAINT knowledge_records_status_before_trash CHECK (
  status_before_trash IN ('proposed', 'active', 'disputed', 'superseded', 'archived', 'expired')
 ),
 CONSTRAINT knowledge_records_trash_state CHECK (
  (trashed_at IS NULL) = (trash_group_id IS NULL) AND (trashed_at IS NULL) = (status_before_trash IS NULL)
 )
);
--> statement-breakpoint
CREATE INDEX knowledge_records_trashed_idx ON knowledge_records (trashed_at) WHERE trashed_at IS NOT NULL;
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
-- Tags are owner-scoped; a merged tag keeps its row so undo can restore it.
CREATE TABLE knowledge_tags (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT knowledge_tags_owner_name_idx UNIQUE(user_id,name),
 CONSTRAINT knowledge_tags_owner_id_idx UNIQUE(user_id,id)
);
--> statement-breakpoint
-- Owner-composite cascading keys: purging a record removes its tag links.
CREATE TABLE knowledge_record_tags (
 user_id uuid NOT NULL, record_id uuid NOT NULL, tag_id uuid NOT NULL,
 PRIMARY KEY (user_id, record_id, tag_id),
 FOREIGN KEY(user_id,record_id) REFERENCES knowledge_records(user_id,id) ON DELETE CASCADE,
 FOREIGN KEY(user_id,tag_id) REFERENCES knowledge_tags(user_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX knowledge_record_tags_owner_tag_idx ON knowledge_record_tags (user_id, tag_id);
--> statement-breakpoint
CREATE TABLE knowledge_tag_merges (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 from_name text NOT NULL, into_tag_id uuid NOT NULL, actor_type text NOT NULL, actor_id uuid NOT NULL,
 record_ids uuid[] NOT NULL, kept_into_record_ids uuid[] NOT NULL, carried_aliases text[] NOT NULL,
 mutation_key uuid NOT NULL, request_hash text NOT NULL, undo_mutation_key uuid NULL,
 created_at timestamptz NOT NULL, undone_at timestamptz NULL,
 CONSTRAINT knowledge_tag_merges_owner_id_idx UNIQUE(user_id,id),
 CONSTRAINT knowledge_tag_merges_owner_key_idx UNIQUE(user_id,mutation_key),
 CONSTRAINT knowledge_tag_merges_owner_undo_key_idx UNIQUE(user_id,undo_mutation_key),
 FOREIGN KEY(user_id,into_tag_id) REFERENCES knowledge_tags(user_id,id) ON DELETE CASCADE,
 CONSTRAINT knowledge_tag_merges_actor_check CHECK (actor_type IN ('user', 'agent')),
 CONSTRAINT knowledge_tag_merges_undo_state CHECK ((undone_at IS NULL) = (undo_mutation_key IS NULL))
);
--> statement-breakpoint
CREATE TABLE knowledge_tag_aliases (
 user_id uuid NOT NULL, alias text NOT NULL, tag_id uuid NOT NULL, merge_id uuid NOT NULL,
 created_at timestamptz NOT NULL,
 PRIMARY KEY (user_id, alias),
 FOREIGN KEY(user_id,tag_id) REFERENCES knowledge_tags(user_id,id) ON DELETE CASCADE,
 FOREIGN KEY(user_id,merge_id) REFERENCES knowledge_tag_merges(user_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
-- Receipts outlive a purged record so a retried mutation stays content-free.
CREATE TABLE knowledge_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 record_id uuid NOT NULL, mutation_key uuid NOT NULL, request_hash text NOT NULL, actor_id uuid NOT NULL,
 CONSTRAINT knowledge_receipts_owner_key_idx UNIQUE(user_id,mutation_key)
);
--> statement-breakpoint
CREATE TABLE knowledge_tombstones (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, record_id uuid NOT NULL,
 trashed_at timestamptz NOT NULL, purged_at timestamptz NOT NULL,
 PRIMARY KEY (user_id, record_id)
);
--> statement-breakpoint
-- from branch 0140_knowledge_lifecycle.sql
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
-- from branch 0144_knowledge_context_receipts.sql
CREATE TABLE "knowledge_context_uses" (
  "id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "actor_id" uuid NOT NULL,
  "actor_type" text NOT NULL,
  "purpose" text,
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
