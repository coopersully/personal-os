-- NULL retains the account's legacy default without an unbounded deployment
-- backfill. The preference owner resolves NULL from default_active_reminder and
-- writes explicit independent defaults on the next save. Existing items are untouched.
ALTER TABLE active_reminder_preferences
 ADD COLUMN default_task_active_reminder boolean,
 ADD COLUMN default_reminder_active_reminder boolean;
