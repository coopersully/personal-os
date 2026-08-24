DO $$
BEGIN
  IF to_regclass('public.finance_mutation_records') IS NOT NULL THEN
    ALTER TABLE "finance_mutation_records"
      ADD COLUMN "lease_expires_at" timestamp with time zone;

    UPDATE "finance_mutation_records"
    SET "lease_expires_at" = "updated_at" + interval '5 minutes'
    WHERE "status" = 'started' AND "lease_expires_at" IS NULL;

    CREATE INDEX "finance_mutation_records_started_lease_idx"
      ON "finance_mutation_records" ("lease_expires_at")
      WHERE "status" = 'started';
  END IF;
END $$;
