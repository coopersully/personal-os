ALTER TABLE texting_agent_runs ADD COLUMN IF NOT EXISTS input_message_ids jsonb NOT NULL DEFAULT '[]';
