import { auditEvents, type Database, todaySettings } from "@personal-os/database";
import {
  resolveTodaySettings,
  type TodaySettings,
  updateTodaySettingsSchema,
} from "@personal-os/domain";
import { eq, sql } from "drizzle-orm";
import { auditValues } from "../audit.js";
import { AppError } from "../errors.js";
import { assertSettingsRevision, type SettingsMutationContext } from "../settings-save.js";

function resolve(row: typeof todaySettings.$inferSelect | undefined): TodaySettings {
  if (!row) return resolveTodaySettings(null);
  const { userId: _owner, updatedAt: _time, ...fields } = row;
  return resolveTodaySettings(fields);
}
export function createTodaySettingsService(db: Database, now: () => Date = () => new Date()) {
  return {
    async get(userId: string) {
      const [row] = await db.select().from(todaySettings).where(eq(todaySettings.userId, userId));
      return resolve(row);
    },
    async update(value: unknown, context: SettingsMutationContext): Promise<TodaySettings> {
      if (context.principal.actorType !== "user")
        throw new AppError("forbidden", "Today preferences require your account session.");
      const input = updateTodaySettingsSchema.parse(value);
      const userId = context.principal.userId;
      return db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`today-settings:${userId}`},0))`,
        );
        const [row] = await tx.select().from(todaySettings).where(eq(todaySettings.userId, userId));
        const previous = resolve(row);
        assertSettingsRevision(
          previous.revision,
          input.expectedRevision,
          "Today preferences changed. Review the latest settings.",
        );
        const fields = {
          ...previous.preferences,
          ...input.preferences,
          userId,
          revision: previous.revision + 1,
          updatedAt: now(),
        };
        const [saved] = await tx
          .insert(todaySettings)
          .values(fields)
          .onConflictDoUpdate({ target: todaySettings.userId, set: fields })
          .returning();
        const result = resolve(saved);
        await tx.insert(auditEvents).values(
          auditValues({
            ...context,
            action: "today.preferences_updated",
            entityId: userId,
            entityType: "today_settings",
            before: previous,
            after: result,
          }),
        );
        return result;
      });
    },
  };
}
