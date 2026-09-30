-- Retain historical local identifiers independently of Texting history retention.
ALTER TABLE finance_contextual_answers ADD COLUMN source_reply_binding_id uuid;
--> statement-breakpoint
ALTER TABLE finance_contextual_answers DROP CONSTRAINT finance_contextual_answers_provenance_check;
ALTER TABLE finance_contextual_answers ADD CONSTRAINT finance_contextual_answers_provenance_check CHECK (
  (
    (((source_kind='app' AND actor_type='user') OR (source_kind='agent' AND actor_type='agent'))
      AND source_message_id IS NULL AND source_reply_binding_id IS NULL)
    OR
    (source_kind='sms' AND actor_type='user' AND actor_id=user_id::text
      AND source_message_id IS NOT NULL
      AND source_message_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND source_reply_binding_id IS NOT NULL)
  ) AND char_length(actor_id) BETWEEN 1 AND 240 AND char_length(request_id) BETWEEN 1 AND 240
);
--> statement-breakpoint
CREATE UNIQUE INDEX finance_contextual_answers_sms_binding_unique
  ON finance_contextual_answers(user_id,source_reply_binding_id);
