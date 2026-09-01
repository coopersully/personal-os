ALTER TABLE "finance_accounts" DROP CONSTRAINT "finance_accounts_ownership_check";
ALTER TABLE "finance_accounts" ADD CONSTRAINT "finance_accounts_ownership_check" CHECK (
  ("ownership_type" = 'individual' AND "ownership_share_bps" IS NOT NULL AND "ownership_share_bps" = 10000)
  OR ("ownership_type" = 'joint' AND "ownership_share_bps" IS NOT NULL AND "ownership_share_bps" BETWEEN 1 AND 10000)
  OR ("ownership_type" = 'unknown' AND "ownership_share_bps" IS NULL)
) NOT VALID;
