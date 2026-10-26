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
