import { auditEvents, type Database, reminders } from "@personal-os/database";
import type {
  CreateReminderInput,
  Reminder,
  ReminderDeferralPreview,
  ReminderDeferralPreviewInput,
  ReminderListQuery,
  UpdateReminderInput,
} from "@personal-os/domain";
import { and, asc, desc, eq, gte, ilike, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import { auditValues } from "./audit.js";
import { requireDatabaseRecord } from "./database.js";
import { AppError } from "./errors.js";
import { decodeCursor, encodeCursor } from "./pagination.js";
import { auditSnapshot, serializeReminder } from "./serialization.js";
import type { Principal } from "./types.js";

type MutationContext = {
  principal: Principal;
  requestId: string;
};

type ReminderServiceOptions = {
  db: Database;
  now: () => Date;
};

export function createReminderService({ db, now }: ReminderServiceOptions) {
  function auditState(
    row: typeof reminders.$inferSelect,
    context: MutationContext,
  ): Record<string, unknown> {
    return {
      ...auditSnapshot(row),
      policy: context.principal.actorType === "user" ? "approve_each" : "approved_rule",
      source: serializeReminder(row).source,
    };
  }

  async function findActive(userId: string, id: string) {
    const [record] = await db
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.id, id),
          eq(reminders.userId, userId),
          eq(reminders.kind, "reminder"),
          isNull(reminders.deletedAt),
        ),
      )
      .limit(1);
    if (!record) {
      throw new AppError("not_found", "The reminder was not found.");
    }
    return record;
  }

  return {
    async complete(id: string, completed: boolean, context: MutationContext): Promise<Reminder> {
      const before = await findActive(context.principal.userId, id);
      const after = await db.transaction(async (transaction) => {
        const updated = requireDatabaseRecord(
          (
            await transaction
              .update(reminders)
              .set({
                completedAt: completed ? now() : null,
                status: completed ? "completed" : "inbox",
                updatedAt: now(),
              })
              .where(eq(reminders.id, before.id))
              .returning()
          )[0],
          "The reminder could not be updated.",
        );
        await transaction.insert(auditEvents).values(
          auditValues({
            action: completed ? "reminder.completed" : "reminder.reopened",
            after: auditState(updated, context),
            before: auditState(before, context),
            entityId: updated.id,
            entityType: "reminder",
            ...context,
          }),
        );
        return updated;
      });
      return serializeReminder(after);
    },

    async create(input: CreateReminderInput, context: MutationContext): Promise<Reminder> {
      const record = await db.transaction(async (transaction) => {
        const created = requireDatabaseRecord(
          (
            await transaction
              .insert(reminders)
              .values({
                dueAt: input.dueAt ? new Date(input.dueAt) : null,
                kind: "reminder",
                notes: input.notes,
                priority: input.priority,
                timezone: input.timezone,
                title: input.title,
                userId: context.principal.userId,
              })
              .returning()
          )[0],
          "The reminder could not be created.",
        );
        await transaction.insert(auditEvents).values(
          auditValues({
            action: "reminder.created",
            after: auditState(created, context),
            before: null,
            entityId: created.id,
            entityType: "reminder",
            ...context,
          }),
        );
        return created;
      });
      return serializeReminder(record);
    },

    async delete(id: string, context: MutationContext): Promise<void> {
      const before = await findActive(context.principal.userId, id);
      await db.transaction(async (transaction) => {
        const after = requireDatabaseRecord(
          (
            await transaction
              .update(reminders)
              .set({ deletedAt: now(), updatedAt: now() })
              .where(eq(reminders.id, before.id))
              .returning()
          )[0],
          "The reminder could not be deleted.",
        );
        await transaction.insert(auditEvents).values(
          auditValues({
            action: "reminder.deleted",
            after: auditState(after, context),
            before: auditState(before, context),
            entityId: after.id,
            entityType: "reminder",
            ...context,
          }),
        );
      });
    },

    async get(id: string, userId: string): Promise<Reminder> {
      return serializeReminder(await findActive(userId, id));
    },

    async list(
      userId: string,
      query: ReminderListQuery,
    ): Promise<{ items: Reminder[]; nextCursor: string | null }> {
      const conditions = [
        eq(reminders.userId, userId),
        eq(reminders.kind, "reminder"),
        isNull(reminders.deletedAt),
      ];
      if (query.completed !== undefined) {
        conditions.push(
          query.completed ? isNotNull(reminders.completedAt) : isNull(reminders.completedAt),
        );
      }
      if (query.dueAfter) {
        conditions.push(gte(reminders.dueAt, new Date(query.dueAfter)));
      }
      if (query.dueBefore) {
        conditions.push(lte(reminders.dueAt, new Date(query.dueBefore)));
      }
      if (query.query) {
        const searchCondition = or(
          ilike(reminders.title, `%${query.query}%`),
          ilike(reminders.notes, `%${query.query}%`),
        );
        if (searchCondition) {
          conditions.push(searchCondition);
        }
      }
      if (query.cursor) {
        const cursor = decodeCursor(query.cursor);
        const cursorCondition = or(
          lt(reminders.createdAt, cursor.createdAt),
          and(eq(reminders.createdAt, cursor.createdAt), lt(reminders.id, cursor.id)),
        );
        if (cursorCondition) {
          conditions.push(cursorCondition);
        }
      }
      const records = await db
        .select()
        .from(reminders)
        .where(and(...conditions))
        .orderBy(desc(reminders.createdAt), desc(reminders.id))
        .limit(query.limit + 1);
      const hasMore = records.length > query.limit;
      const page = hasMore ? records.slice(0, query.limit) : records;
      const last = page.at(-1);
      return {
        items: page.map(serializeReminder),
        nextCursor:
          hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
      };
    },

    async previewOverdueDeferral(
      userId: string,
      input: ReminderDeferralPreviewInput,
    ): Promise<ReminderDeferralPreview> {
      const conditions = [
        eq(reminders.userId, userId),
        eq(reminders.kind, "reminder"),
        isNull(reminders.completedAt),
        isNull(reminders.deletedAt),
        lt(reminders.dueAt, new Date(input.overdueBefore)),
      ];
      if (input.priority) conditions.push(eq(reminders.priority, input.priority));
      const records = await db
        .select()
        .from(reminders)
        .where(and(...conditions))
        .orderBy(asc(reminders.dueAt), asc(reminders.id))
        .limit(input.limit + 1);
      if (records.length > input.limit) {
        throw new AppError(
          "invalid_request",
          "The overdue reminder preview exceeds its safety limit. Narrow the cutoff or priority.",
          { limit: input.limit, matchedCountAtLeast: records.length },
        );
      }
      return {
        candidates: records.map((record) => {
          const reminder = serializeReminder(record);
          if (!reminder.dueAt) {
            throw new AppError("invalid_request", "An overdue reminder must have a due time.");
          }
          return {
            dueAt: reminder.dueAt,
            id: reminder.id,
            priority: reminder.priority,
            proposedDueAt: input.proposedDueAt,
            proposedTimezone: input.timezone,
            source: reminder.source,
            title: reminder.title,
            updatedAt: reminder.updatedAt,
          };
        }),
        matchedCount: records.length,
        policy: "preview",
      };
    },

    async restore(id: string, context: MutationContext): Promise<Reminder> {
      const [before] = await db
        .select()
        .from(reminders)
        .where(
          and(
            eq(reminders.id, id),
            eq(reminders.userId, context.principal.userId),
            eq(reminders.kind, "reminder"),
            isNotNull(reminders.deletedAt),
          ),
        )
        .limit(1);
      if (!before) {
        throw new AppError("not_found", "The deleted reminder was not found.");
      }
      const after = await db.transaction(async (transaction) => {
        const restored = requireDatabaseRecord(
          (
            await transaction
              .update(reminders)
              .set({ deletedAt: null, updatedAt: now() })
              .where(eq(reminders.id, before.id))
              .returning()
          )[0],
          "The reminder could not be restored.",
        );
        await transaction.insert(auditEvents).values(
          auditValues({
            action: "reminder.restored",
            after: auditState(restored, context),
            before: auditState(before, context),
            entityId: restored.id,
            entityType: "reminder",
            ...context,
          }),
        );
        return restored;
      });
      return serializeReminder(after);
    },

    async update(
      id: string,
      input: UpdateReminderInput,
      context: MutationContext,
    ): Promise<Reminder> {
      const before = await findActive(context.principal.userId, id);
      if (input.expectedUpdatedAt && input.expectedUpdatedAt !== before.updatedAt.toISOString()) {
        throw new AppError("conflict", "The reminder changed since it was loaded.", {
          currentUpdatedAt: before.updatedAt.toISOString(),
        });
      }
      const after = await db.transaction(async (transaction) => {
        const updated = requireDatabaseRecord(
          (
            await transaction
              .update(reminders)
              .set({
                ...(input.dueAt === undefined
                  ? {}
                  : { dueAt: input.dueAt ? new Date(input.dueAt) : null }),
                ...(input.notes === undefined ? {} : { notes: input.notes }),
                ...(input.priority === undefined ? {} : { priority: input.priority }),
                ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
                ...(input.title === undefined ? {} : { title: input.title }),
                updatedAt: now(),
              })
              .where(eq(reminders.id, before.id))
              .returning()
          )[0],
          "The reminder could not be updated.",
        );
        await transaction.insert(auditEvents).values(
          auditValues({
            action: "reminder.updated",
            after: auditState(updated, context),
            before: auditState(before, context),
            entityId: updated.id,
            entityType: "reminder",
            ...context,
          }),
        );
        return updated;
      });
      return serializeReminder(after);
    },
  };
}
