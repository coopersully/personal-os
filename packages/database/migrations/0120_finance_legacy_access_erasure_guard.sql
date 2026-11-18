-- Preserve one-time migration provenance except during actual owner erasure.
-- Published 0118 remains unchanged; this expands its immutable guard to DELETE.
CREATE OR REPLACE FUNCTION protect_finance_onboarding_legacy_access() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id) THEN
  RETURN OLD;
 END IF;
 RAISE EXCEPTION 'Migration-time Finance access provenance is immutable except for owner erasure' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
DROP TRIGGER finance_onboarding_legacy_access_immutable ON finance_onboarding_legacy_access;
CREATE TRIGGER finance_onboarding_legacy_access_immutable
BEFORE UPDATE OR DELETE ON finance_onboarding_legacy_access
FOR EACH ROW EXECUTE FUNCTION protect_finance_onboarding_legacy_access();
