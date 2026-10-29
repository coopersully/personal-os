-- Bound deployment lock waits and every statement; restore the caller's settings afterwards.
SELECT set_config('nohmi.preferences_migration_statement_timeout',current_setting('statement_timeout'),true),
       set_config('nohmi.preferences_migration_lock_timeout',current_setting('lock_timeout'),true);
--> statement-breakpoint
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';
--> statement-breakpoint
DO $$ BEGIN
 IF (SELECT count(*) FROM (SELECT 1 FROM users LIMIT 100001) bounded_users) > 100000 THEN
  RAISE EXCEPTION 'Finance legacy-access migration exceeds the 100000-owner bound; coordinate a bounded operational backfill';
 END IF;
END; $$;
--> statement-breakpoint
-- Constant defaults preserve existing preference rows and their revisions without a data rewrite.
ALTER TABLE finances_workspace_settings
 ADD COLUMN finance_manual_visibility text NOT NULL DEFAULT 'auto',
 ADD COLUMN finance_spending_view text NOT NULL DEFAULT 'bubbles',
 ADD COLUMN finance_spending_grouping text NOT NULL DEFAULT 'auto',
 ADD COLUMN finance_spending_include_pending boolean NOT NULL DEFAULT true,
 ADD COLUMN finance_spending_include_uncategorized boolean NOT NULL DEFAULT true,
 ADD COLUMN finance_spending_basis text NOT NULL DEFAULT 'personal_cost',
 ADD COLUMN finance_spending_subtract_refunds boolean NOT NULL DEFAULT true,
 ADD COLUMN finance_spending_period text NOT NULL DEFAULT 'month',
 ADD CONSTRAINT finances_manual_visibility_check CHECK (finance_manual_visibility IN ('auto','show','hide')),
 ADD CONSTRAINT finances_spending_view_check CHECK (finance_spending_view IN ('bubbles','list','trends','rhythm')),
 ADD CONSTRAINT finances_spending_grouping_check CHECK (finance_spending_grouping IN ('auto','buckets','categories')),
 ADD CONSTRAINT finances_spending_basis_check CHECK (finance_spending_basis IN ('personal_cost','full_outflow')),
 ADD CONSTRAINT finances_spending_period_check CHECK (finance_spending_period IN ('today','week','month','custom'));
--> statement-breakpoint
CREATE TABLE finance_onboarding_legacy_access (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 granted_at timestamptz NOT NULL DEFAULT now(),
 provenance text NOT NULL DEFAULT 'finance_records_at_migration',
 CONSTRAINT finance_onboarding_legacy_access_provenance_check CHECK (provenance = 'finance_records_at_migration')
);
--> statement-breakpoint
-- One-time owner-index EXISTS seed, bounded by both work and time. Larger populations must
-- use a separately reviewed operational backfill; never hold deployment locks indefinitely.
DO $$
BEGIN
 INSERT INTO finance_onboarding_legacy_access(user_id,granted_at,provenance)
 SELECT u.id,transaction_timestamp(),'finance_records_at_migration'
 FROM users u
 WHERE EXISTS (SELECT 1 FROM finance_accounts r WHERE r.user_id=u.id)
    OR EXISTS (SELECT 1 FROM finance_transactions r WHERE r.user_id=u.id)
    OR EXISTS (SELECT 1 FROM finance_profile_versions r WHERE r.user_id=u.id)
    OR EXISTS (SELECT 1 FROM finance_profiles r WHERE r.user_id=u.id)
    OR EXISTS (SELECT 1 FROM finance_setup_sessions r WHERE r.user_id=u.id)
    OR EXISTS (SELECT 1 FROM finance_budget_plans r WHERE r.user_id=u.id)
    OR EXISTS (SELECT 1 FROM finance_goals r WHERE r.user_id=u.id)
    OR EXISTS (SELECT 1 FROM finance_provider_items r WHERE r.user_id=u.id);
END;
$$;
--> statement-breakpoint
-- No INSERT trigger on Finance records: accounts created after this migration never auto-grant.
CREATE FUNCTION protect_finance_onboarding_legacy_access() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Migration-time Finance access provenance is immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER finance_onboarding_legacy_access_immutable BEFORE UPDATE ON finance_onboarding_legacy_access
FOR EACH ROW EXECUTE FUNCTION protect_finance_onboarding_legacy_access();

--> statement-breakpoint
SELECT set_config('statement_timeout',current_setting('nohmi.preferences_migration_statement_timeout'),true),
       set_config('lock_timeout',current_setting('nohmi.preferences_migration_lock_timeout'),true);
