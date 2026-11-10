CREATE TABLE finance_conversation_turns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 automation_schedule_id uuid NOT NULL, authorization_connection_id uuid NOT NULL,
 cutoff_sequence bigint NOT NULL CHECK (cutoff_sequence > 0), created_at timestamptz NOT NULL,
 CONSTRAINT finance_conversation_turns_owner_id_idx UNIQUE(user_id, id),
 CONSTRAINT finance_conversation_turns_schedule_fk FOREIGN KEY(user_id, automation_schedule_id) REFERENCES automation_host_schedules(user_id, id)
);
--> statement-breakpoint
CREATE TABLE finance_conversation_turn_messages (
 user_id uuid NOT NULL, turn_id uuid NOT NULL, message_id uuid NOT NULL,
 delivered_at timestamptz, acknowledged_at timestamptz, reply_message_id uuid,
 PRIMARY KEY(user_id, turn_id, message_id),
 CONSTRAINT finance_conversation_turn_messages_once_idx UNIQUE(user_id, message_id),
 CONSTRAINT finance_conversation_turn_messages_turn_fk FOREIGN KEY(user_id, turn_id) REFERENCES finance_conversation_turns(user_id, id) ON DELETE CASCADE,
 CONSTRAINT finance_conversation_turn_messages_source_fk FOREIGN KEY(user_id, message_id) REFERENCES finance_conversation_messages(user_id, id),
 CONSTRAINT finance_conversation_turn_messages_reply_fk FOREIGN KEY(user_id, reply_message_id) REFERENCES finance_conversation_messages(user_id, id),
 CONSTRAINT finance_conversation_turn_messages_ack_check CHECK (acknowledged_at IS NULL OR delivered_at IS NOT NULL),
 CONSTRAINT finance_conversation_turn_messages_reply_check CHECK (reply_message_id IS NULL OR delivered_at IS NOT NULL)
);
