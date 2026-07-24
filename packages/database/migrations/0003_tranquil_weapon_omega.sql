CREATE TABLE "mail_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"remote_thread_id" text NOT NULL,
	"subject" text NOT NULL,
	"snippet" text NOT NULL,
	"body_text" text NOT NULL,
	"from_address" jsonb NOT NULL,
	"to_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"remote_mailbox_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"message_count" integer DEFAULT 1 NOT NULL,
	"unread" boolean DEFAULT false NOT NULL,
	"starred" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailboxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"remote_mailbox_id" text NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'custom' NOT NULL,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"total_count" integer DEFAULT 0 NOT NULL,
	"last_synced_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar_accounts" ADD COLUMN "calendar_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_accounts" ADD COLUMN "mail_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD COLUMN "target_account_id" uuid;--> statement-breakpoint
ALTER TABLE "mail_threads" ADD CONSTRAINT "mail_threads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_threads" ADD CONSTRAINT "mail_threads_account_id_calendar_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."calendar_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailboxes" ADD CONSTRAINT "mailboxes_account_id_calendar_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."calendar_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mail_threads_user_time_idx" ON "mail_threads" USING btree ("user_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_threads_remote_idx" ON "mail_threads" USING btree ("account_id","remote_thread_id");--> statement-breakpoint
CREATE INDEX "mailboxes_user_idx" ON "mailboxes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mailboxes_remote_idx" ON "mailboxes" USING btree ("account_id","remote_mailbox_id");