CREATE UNIQUE INDEX "finance_transaction_allocations_id_user_id_unique" ON "finance_transaction_allocations" USING btree ("id", "user_id");
--> statement-breakpoint
CREATE TABLE "finance_reimbursements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"allocation_id" uuid NOT NULL,
	"expected_amount_cents" integer NOT NULL,
	"received_amount_cents" integer DEFAULT 0 NOT NULL,
	"payer" text,
	"due_date" text,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rationale" text NOT NULL,
	"status" text DEFAULT 'expected' NOT NULL,
	"cancelled_at" timestamptz,
	"cancelled_evidence" jsonb,
	"cancelled_rationale" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "finance_reimbursements_expected_amount_check" CHECK ("expected_amount_cents" > 0),
	CONSTRAINT "finance_reimbursements_received_amount_check" CHECK ("received_amount_cents" >= 0 AND "received_amount_cents" <= "expected_amount_cents"),
	CONSTRAINT "finance_reimbursements_status_check" CHECK ("status" IN ('expected', 'partially_received', 'received', 'overdue', 'cancelled', 'needs_input'))
);
--> statement-breakpoint
ALTER TABLE "finance_reimbursements" ADD CONSTRAINT "finance_reimbursements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "finance_reimbursements" ADD CONSTRAINT "finance_reimbursements_allocation_id_finance_transaction_allocations_id_fk" FOREIGN KEY ("allocation_id") REFERENCES "public"."finance_transaction_allocations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "finance_reimbursements" ADD CONSTRAINT "finance_reimbursements_allocation_user_fk" FOREIGN KEY ("allocation_id", "user_id") REFERENCES "public"."finance_transaction_allocations"("id", "user_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_reimbursements_id_user_id_unique" ON "finance_reimbursements" USING btree ("id", "user_id");
--> statement-breakpoint
CREATE INDEX "finance_reimbursements_user_status_due_idx" ON "finance_reimbursements" USING btree ("user_id", "status", "due_date");
--> statement-breakpoint
CREATE INDEX "finance_reimbursements_user_allocation_idx" ON "finance_reimbursements" USING btree ("user_id", "allocation_id");
--> statement-breakpoint
CREATE TABLE "finance_reimbursement_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"reimbursement_id" uuid NOT NULL,
	"credit_transaction_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rationale" text NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	"updated_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "finance_reimbursement_matches_amount_check" CHECK ("amount_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "finance_reimbursement_matches" ADD CONSTRAINT "finance_reimbursement_matches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "finance_reimbursement_matches" ADD CONSTRAINT "finance_reimbursement_matches_reimbursement_id_finance_reimbursements_id_fk" FOREIGN KEY ("reimbursement_id") REFERENCES "public"."finance_reimbursements"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "finance_reimbursement_matches" ADD CONSTRAINT "finance_reimbursement_matches_credit_transaction_id_finance_transactions_id_fk" FOREIGN KEY ("credit_transaction_id") REFERENCES "public"."finance_transactions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "finance_reimbursement_matches" ADD CONSTRAINT "finance_reimbursement_matches_reimbursement_user_fk" FOREIGN KEY ("reimbursement_id", "user_id") REFERENCES "public"."finance_reimbursements"("id", "user_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "finance_reimbursement_matches" ADD CONSTRAINT "finance_reimbursement_matches_credit_user_fk" FOREIGN KEY ("credit_transaction_id", "user_id") REFERENCES "public"."finance_transactions"("id", "user_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "finance_reimbursement_matches_reimbursement_credit_idx" ON "finance_reimbursement_matches" USING btree ("reimbursement_id", "credit_transaction_id");
--> statement-breakpoint
CREATE INDEX "finance_reimbursement_matches_user_credit_idx" ON "finance_reimbursement_matches" USING btree ("user_id", "credit_transaction_id");
