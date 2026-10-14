-- Both 0112 migrations were published independently. Keep their SQL, timestamps and
-- journal entries immutable. A database that already applied the later Today
-- migration skips the earlier connector timestamp; this append-only repair covers it.
ALTER TABLE "calendar_accounts" ADD COLUMN IF NOT EXISTS "sync_capabilities" jsonb;
