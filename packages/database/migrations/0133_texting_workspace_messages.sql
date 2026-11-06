ALTER TABLE text_messages
 ADD COLUMN workspaces jsonb NOT NULL DEFAULT '[]',
 ADD COLUMN sender_kind text,
 ADD COLUMN reply_to_message_ids jsonb NOT NULL DEFAULT '[]',
 ADD COLUMN classified_at timestamptz,
 ADD COLUMN agent_run_id uuid,
 ADD COLUMN reply_key text,
 ADD COLUMN reply_final boolean,
 ADD CONSTRAINT text_messages_sender_kind_check CHECK(sender_kind IS NULL OR sender_kind IN ('human','agent','system'));
CREATE UNIQUE INDEX text_messages_agent_reply_idx ON text_messages(user_id,agent_run_id,reply_key);
--> statement-breakpoint
ALTER TABLE texting_agent_runs ADD COLUMN failure_notice_message_id uuid,
 ADD CONSTRAINT texting_agent_runs_notice_fk FOREIGN KEY(user_id,failure_notice_message_id,connection_id) REFERENCES text_messages(user_id,id,connection_id);
