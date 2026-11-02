import { activeReminderPreferences, type Database } from "@personal-os/database";
import type { ActiveReminderPreferences } from "@personal-os/domain";
import { eq } from "drizzle-orm";

export async function readActiveReminderPreferences(
  db: Pick<Database, "select">,
  userId: string,
): Promise<ActiveReminderPreferences> {
  const [row] = await db
    .select({
      defaultActiveReminder: activeReminderPreferences.defaultActiveReminder,
      defaultTaskActiveReminder: activeReminderPreferences.defaultTaskActiveReminder,
      defaultReminderActiveReminder: activeReminderPreferences.defaultReminderActiveReminder,
      revision: activeReminderPreferences.revision,
    })
    .from(activeReminderPreferences)
    .where(eq(activeReminderPreferences.userId, userId));
  const defaultTaskActiveReminder =
    row?.defaultTaskActiveReminder ?? row?.defaultActiveReminder ?? false;
  const defaultReminderActiveReminder =
    row?.defaultReminderActiveReminder ?? row?.defaultActiveReminder ?? false;
  return {
    // Legacy readers see enabled only when both creation defaults are enabled.
    defaultActiveReminder: defaultTaskActiveReminder && defaultReminderActiveReminder,
    defaultTaskActiveReminder,
    defaultReminderActiveReminder,
    revision: row?.revision ?? 0,
  };
}
