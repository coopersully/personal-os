CREATE TABLE "automation_routines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"template" text NOT NULL,
	"title" text NOT NULL,
	"schedule" text NOT NULL,
	"timezone" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"routine_id" uuid NOT NULL,
	"status" text NOT NULL,
	"summary" text NOT NULL,
	"brief" jsonb,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "automation_routines" ADD CONSTRAINT "automation_routines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_routine_id_automation_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."automation_routines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_routines_user_idx" ON "automation_routines" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "automation_routines_user_template_idx" ON "automation_routines" USING btree ("user_id","template");--> statement-breakpoint
CREATE INDEX "automation_runs_routine_time_idx" ON "automation_runs" USING btree ("routine_id","started_at");--> statement-breakpoint
CREATE INDEX "automation_runs_user_time_idx" ON "automation_runs" USING btree ("user_id","started_at");