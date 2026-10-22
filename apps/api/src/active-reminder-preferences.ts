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
      revision: activeReminderPreferences.revision,
    })
    .from(activeReminderPreferences)
    .where(eq(activeReminderPreferences.userId, userId));
  return row ?? { defaultActiveReminder: false, revision: 0 };
}
