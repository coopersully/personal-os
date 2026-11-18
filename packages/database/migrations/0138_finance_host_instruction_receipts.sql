CREATE TABLE finance_host_instruction_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 schedule_id uuid NOT NULL,
 authorization_connection_id uuid NOT NULL,
 actor_id uuid NOT NULL,
 operation_id uuid NOT NULL,
 schedule_version integer NOT NULL,
 instruction_version integer NOT NULL,
 text text NOT NULL,
 served_at timestamptz NOT NULL,
 acknowledged_at timestamptz,
 CONSTRAINT finance_host_instruction_receipts_schedule_fk FOREIGN KEY(user_id, schedule_id) REFERENCES automation_host_schedules(user_id, id) ON DELETE CASCADE,
 CONSTRAINT finance_host_instruction_receipts_versions_check CHECK(schedule_version > 0 AND instruction_version > 0),
 CONSTRAINT finance_host_instruction_receipts_text_check CHECK(length(text) BETWEEN 1 AND 20000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX finance_host_instruction_receipts_operation_idx ON finance_host_instruction_receipts(user_id, schedule_id, operation_id);
