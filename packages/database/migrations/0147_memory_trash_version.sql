ALTER TABLE knowledge_records ADD COLUMN trash_version integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE knowledge_records ADD CONSTRAINT knowledge_records_trash_version CHECK (trash_version >= 0);
--> statement-breakpoint
-- Disclosure reads a record's sources, and purge and cascades delete them, by record.
CREATE INDEX knowledge_sources_owner_record_idx ON knowledge_sources (user_id, record_id);
--> statement-breakpoint
-- Purge and the cascade from a deleted record find links pointing at it by the related record.
CREATE INDEX knowledge_relationships_owner_related_idx ON knowledge_relationships (user_id, related_record_id);
