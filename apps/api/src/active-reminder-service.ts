import { createHmac, timingSafeEqual } from "node:crypto";
import {
  activeReminderPreferences,
  auditEvents,
  type Database,
  reminders,
} from "@personal-os/database";
import {
  type ActiveReminderCandidatePage,
  type ActiveReminderPreferences,
  idSchema,
  isoDateTimeSchema,
} from "@personal-os/domain";
import { and, asc, eq, gt, isNull, lte, ne, or } from "drizzle-orm";
import { z } from "zod";
import { readActiveReminderPreferences } from "./active-reminder-preferences.js";
import { auditValues } from "./audit.js";
import { AppError } from "./errors.js";
import type { Principal } from "./types.js";

const cursorSchema = z
  .object({
    version: z.literal(1),
    owner: idSchema,
    generatedAt: isoDateTimeSchema,
    cutoff: isoDateTimeSchema,
    kind: z.enum(["task", "reminder"]),
    id: idSchema,
  })
  .strict();
export function createActiveReminderService({
  db,
  now,
  cursorSecret,
}: {
  db: Database;
  now: () => Date;
  cursorSecret: string;
}) {
  function sign(body: string) {
    return createHmac("sha256", cursorSecret).update(`active-reminders.v1:${body}`).digest();
  }
  function decode(token: string, userId: string) {
    try {
      if (token.length > 2048) throw new Error();
      const [body, signature, extra] = token.split(".");
      if (!body || !signature || extra) throw new Error();
      const expected = sign(body);
      const supplied = Buffer.from(signature, "base64url");
      if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
        throw new Error();
      const value = cursorSchema.parse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
      const age = now().getTime() - Date.parse(value.generatedAt);
      if (value.owner !== userId || age < 0 || age > 300_000) throw new Error();
      return value;
    } catch {
      throw new AppError("invalid_request", "The active reminder cursor is invalid or expired.");
    }
  }
  return {
    getPreferences(userId: string): Promise<ActiveReminderPreferences> {
      return readActiveReminderPreferences(db, userId);
    },
    async savePreferences(
      userId: string,
      input: { defaultActiveReminder: boolean; expectedRevision: number },
      context: { principal: Principal; requestId: string },
    ): Promise<ActiveReminderPreferences> {
      if (context.principal.actorType !== "user" || context.principal.userId !== userId)
        throw new AppError("forbidden", "Sign in to change active reminder preferences.");
      return db.transaction(async (tx) => {
        const before = await readActiveReminderPreferences(tx, userId);
        const value = {
          userId,
          defaultActiveReminder: input.defaultActiveReminder,
          revision: input.expectedRevision + 1,
          updatedAt: now(),
        };
        const [saved] =
          input.expectedRevision === 0
            ? await tx
                .insert(activeReminderPreferences)
                .values(value)
                .onConflictDoNothing()
                .returning()
            : await tx
                .update(activeReminderPreferences)
                .set(value)
                .where(
                  and(
                    eq(activeReminderPreferences.userId, userId),
                    eq(activeReminderPreferences.revision, input.expectedRevision),
                  ),
                )
                .returning();
        if (!saved)
          throw new AppError(
            "conflict",
            "Active reminder preferences changed. Reload and try again.",
          );
        const after = {
          defaultActiveReminder: saved.defaultActiveReminder,
          revision: saved.revision,
        };
        await tx.insert(auditEvents).values(
          auditValues({
            ...context,
            action: "active_reminder.preferences_saved",
            entityType: "active_reminder_preferences",
            entityId: userId,
            before,
            after,
          }),
        );
        return after;
      });
    },
    async listCandidates(
      userId: string,
      query: { cursor?: string | undefined; limit?: number },
    ): Promise<ActiveReminderCandidatePage> {
      const limit = query.limit ?? 100;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw new AppError("invalid_request", "Choose a limit between 1 and 100.");
      const cursor = query.cursor ? decode(query.cursor, userId) : undefined;
      const generatedAt = cursor?.generatedAt ?? now().toISOString();
      const cutoff = cursor?.cutoff ?? new Date(Date.parse(generatedAt) + 86_400_000).toISOString();
      const records = await db
        .select()
        .from(reminders)
        .where(
          and(
            eq(reminders.userId, userId),
            eq(reminders.activeReminder, true),
            isNull(reminders.completedAt),
            isNull(reminders.deletedAt),
            ne(reminders.status, "cancelled"),
            or(eq(reminders.kind, "reminder"), eq(reminders.taskLifecycle, "open")),
            lte(reminders.dueAt, new Date(cutoff)),
            cursor
              ? or(
                  gt(reminders.kind, cursor.kind),
                  and(eq(reminders.kind, cursor.kind), gt(reminders.id, cursor.id)),
                )
              : undefined,
          ),
        )
        .orderBy(asc(reminders.kind), asc(reminders.id))
        .limit(limit + 1);
      const page = records.slice(0, limit);
      const last = page.at(-1);
      const items = page.map((row) => {
        if (!row.dueAt)
          throw new AppError("internal_error", "An active reminder candidate has no due time.");
        const common = {
          id: row.id,
          title: row.title,
          dueAt: row.dueAt.toISOString(),
          activeReminder: true as const,
        };
        if (row.kind === "task") {
          if (!row.taskRevision)
            throw new AppError("internal_error", "An active task has no revision.");
          return { ...common, kind: "task" as const, revision: row.taskRevision };
        }
        return { ...common, kind: "reminder" as const, updatedAt: row.updatedAt.toISOString() };
      });
      let nextCursor: string | null = null;
      if (records.length > limit && last) {
        const body = Buffer.from(
          JSON.stringify({
            version: 1,
            owner: userId,
            generatedAt,
            cutoff,
            kind: last.kind,
            id: last.id,
          }),
        ).toString("base64url");
        nextCursor = `${body}.${sign(body).toString("base64url")}`;
      }
      return { generatedAt, items, nextCursor };
    },
  };
}
