ALTER TABLE access_tokens ADD COLUMN authorization_connection_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE workspace_maintenance_runs ADD COLUMN authorization_connection_id uuid, ADD COLUMN automation_schedule_id uuid;
ALTER TABLE finance_answer_continuations ADD COLUMN source_kind text NOT NULL DEFAULT 'maintenance_question', ADD COLUMN contextual_question_id uuid, ADD COLUMN automation_schedule_id uuid, ADD COLUMN host_session_id text, ADD COLUMN fire_state text NOT NULL DEFAULT 'pending';
ALTER TABLE finance_answer_continuations ADD CONSTRAINT finance_answer_continuations_fire_state_check CHECK(fire_state IN ('pending','submitting','accepted','uncertain','unavailable'));
CREATE TABLE automation_host_schedules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 authorization_connection_id uuid NOT NULL, schedule jsonb NOT NULL, encrypted_fire_credentials jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX automation_host_schedules_owner_unique ON automation_host_schedules(user_id,id);
CREATE INDEX automation_host_schedules_connection_idx ON automation_host_schedules(user_id,authorization_connection_id);
ALTER TABLE workspace_maintenance_runs ADD CONSTRAINT workspace_maintenance_runs_host_owner_fk FOREIGN KEY(user_id,automation_schedule_id) REFERENCES automation_host_schedules(user_id,id);
ALTER TABLE finance_answer_continuations ADD CONSTRAINT finance_answer_continuations_host_owner_fk FOREIGN KEY(user_id,automation_schedule_id) REFERENCES automation_host_schedules(user_id,id);

--> statement-breakpoint
CREATE OR REPLACE FUNCTION finance_archive_transaction_reviews(owner_id uuid, source_id uuid) RETURNS void
 LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
 BEGIN
 PERFORM 1 FROM public.finance_review_cases WHERE user_id=owner_id AND transaction_id=source_id ORDER BY id FOR UPDATE;
 INSERT INTO public.finance_review_archives(id,user_id,first_seen_at,snapshot,context,questions,answers)
 SELECT r.id,r.user_id,r.first_seen_at,to_jsonb(r),
 jsonb_build_object('accountId',t.account_id,'accountName',a.name,'institution',a.institution,'merchant',t.merchant,'date',t.transaction_date,'amount',t.amount_cents::numeric/100,'currencyCode',t.currency_code,'direction',t.direction,'pending',t.pending),
 COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.id) FROM public.finance_contextual_questions q WHERE q.user_id=r.user_id AND q.review_case_id=r.id),'[]'::jsonb) || COALESCE((SELECT jsonb_agg(jsonb_build_object('id',req.id,'prompt',req.prompt,'state',req.state) ORDER BY req.action_revision) FROM public.finance_review_action_requests req WHERE req.user_id=r.user_id AND req.review_case_id=r.id),'[]'::jsonb),
 COALESCE((SELECT jsonb_agg(to_jsonb(ans) ORDER BY ans.recorded_at,ans.id) FROM public.finance_contextual_answers ans JOIN public.finance_contextual_questions q ON q.user_id=ans.user_id AND q.id=ans.question_id WHERE q.user_id=r.user_id AND q.review_case_id=r.id),'[]'::jsonb) || COALESCE((SELECT jsonb_agg(to_jsonb(ans) ORDER BY ans.recorded_at,ans.id) FROM public.finance_review_answers ans WHERE ans.user_id=r.user_id AND ans.review_case_id=r.id),'[]'::jsonb)
 FROM public.finance_review_cases r JOIN public.finance_transactions t ON t.id=r.transaction_id AND t.user_id=r.user_id
 JOIN public.finance_accounts a ON a.id=t.account_id AND a.user_id=t.user_id
 WHERE r.user_id=owner_id AND t.id=source_id AND EXISTS(SELECT 1 FROM public.users WHERE id=owner_id)
 ON CONFLICT(id) DO NOTHING;
 END;
$$;
