CREATE TABLE texting_agent_settings (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 schedule_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT texting_agent_settings_schedule_fk FOREIGN KEY(user_id,schedule_id) REFERENCES automation_host_schedules(user_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE texting_agent_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 connection_id uuid NOT NULL, consent_epoch integer NOT NULL CHECK(consent_epoch > 0),
 schedule_id uuid NOT NULL, authorization_connection_id uuid NOT NULL, invocation_id uuid,
 state text NOT NULL CHECK(state IN ('submitting','started','running','completed','uncertain','blocked')),
 reason text, host_session_id text, reply_message_id uuid, work jsonb NOT NULL DEFAULT '[]',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT texting_agent_runs_connection_fk FOREIGN KEY(user_id,connection_id) REFERENCES texting_connections(user_id,id),
 CONSTRAINT texting_agent_runs_reply_fk FOREIGN KEY(user_id,reply_message_id,connection_id) REFERENCES text_messages(user_id,id,connection_id)
);
CREATE UNIQUE INDEX texting_agent_runs_owner_id_idx ON texting_agent_runs(user_id,id);
CREATE UNIQUE INDEX texting_agent_runs_active_idx ON texting_agent_runs(user_id) WHERE state IN ('submitting','started','running','uncertain');
CREATE INDEX texting_agent_runs_history_idx ON texting_agent_runs(user_id,created_at);
--> statement-breakpoint
CREATE TABLE texting_agent_queue (
 claim_id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 run_id uuid, available_at timestamptz NOT NULL, cancelled_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT texting_agent_queue_claim_fk FOREIGN KEY(user_id,claim_id) REFERENCES text_inbound_claims(user_id,id) ON DELETE CASCADE,
 CONSTRAINT texting_agent_queue_run_fk FOREIGN KEY(user_id,run_id) REFERENCES texting_agent_runs(user_id,id) ON DELETE CASCADE
);
CREATE INDEX texting_agent_queue_due_idx ON texting_agent_queue(available_at) WHERE run_id IS NULL;
--> statement-breakpoint
CREATE TABLE texting_agent_work (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, domain text NOT NULL, key text NOT NULL,
 run_id uuid NOT NULL, item jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,domain,key),
 CONSTRAINT texting_agent_work_run_fk FOREIGN KEY(user_id,run_id) REFERENCES texting_agent_runs(user_id,id) ON DELETE CASCADE
);
