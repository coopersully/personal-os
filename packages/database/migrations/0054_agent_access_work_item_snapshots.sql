CREATE TABLE "agent_access_work_item_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"actor_type" text NOT NULL,
	"domain" text,
	"kind" text,
	"items" jsonb NOT NULL,
	"filtered_total" integer,
	"summary" jsonb NOT NULL,
	"unavailable_domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_access_work_item_snapshots" ADD CONSTRAINT "agent_access_work_item_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "agent_access_work_item_snapshots_user_expiry_idx" ON "agent_access_work_item_snapshots" USING btree ("user_id","expires_at");
