ALTER TABLE "calendar_events" ADD COLUMN "block_source_event_id" uuid;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD COLUMN "block_mode" text;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_block_source_event_id_calendar_events_id_fk" FOREIGN KEY ("block_source_event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calendar_events_block_source_idx" ON "calendar_events" USING btree ("block_source_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_events_block_destination_idx" ON "calendar_events" USING btree ("block_source_event_id","calendar_id");