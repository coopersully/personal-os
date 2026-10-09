-- Databases that already applied 0105 retain its original SQL function.
-- Replace it without rewriting the immutable evidence already archived there.
CREATE OR REPLACE FUNCTION finance_archive_transaction_reviews(owner_id uuid, source_id uuid) RETURNS void
 LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
 BEGIN
 PERFORM 1 FROM public.finance_review_cases WHERE user_id=owner_id AND transaction_id=source_id ORDER BY id FOR UPDATE;
 INSERT INTO public.finance_review_archives(id,user_id,first_seen_at,snapshot,context,questions,answers)
 SELECT r.id,r.user_id,r.first_seen_at,to_jsonb(r),
 jsonb_build_object('accountId',t.account_id,'accountName',a.name,'institution',a.institution,'merchant',t.merchant,'date',t.transaction_date,'amount',t.amount_cents::numeric/100,'currencyCode',t.currency_code,'direction',t.direction,'pending',t.pending),
 COALESCE((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.id) FROM public.finance_contextual_questions q WHERE q.user_id=r.user_id AND q.review_case_id=r.id),'[]'::jsonb),
 COALESCE((SELECT jsonb_agg(to_jsonb(ans) ORDER BY ans.recorded_at,ans.id) FROM public.finance_contextual_answers ans JOIN public.finance_contextual_questions q ON q.user_id=ans.user_id AND q.id=ans.question_id WHERE q.user_id=r.user_id AND q.review_case_id=r.id),'[]'::jsonb)
 FROM public.finance_review_cases r JOIN public.finance_transactions t ON t.id=r.transaction_id AND t.user_id=r.user_id
 JOIN public.finance_accounts a ON a.id=t.account_id AND a.user_id=t.user_id
 WHERE r.user_id=owner_id AND t.id=source_id AND EXISTS(SELECT 1 FROM public.users WHERE id=owner_id)
 ON CONFLICT(id) DO NOTHING;
 END;
$$;
