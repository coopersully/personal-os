ALTER TABLE "attention_items" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;
ALTER TABLE "attention_items" ADD CONSTRAINT "attention_items_version_check" CHECK ("attention_items"."version" > 0);
