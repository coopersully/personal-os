import { auditEvents, type Database, reminders } from "@personal-os/database";
import type { CreateTaskInput, Task, TaskListQuery, UpdateTaskInput } from "@personal-os/domain";
import { and, desc, eq, gte, ilike, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import { auditValues } from "./audit.js";
import { requireDatabaseRecord } from "./database.js";
import { AppError } from "./errors.js";
import { decodeCursor, encodeCursor } from "./pagination.js";
import { auditSnapshot, serializeTask } from "./serialization.js";
import type { Principal } from "./types.js";

type MutationContext = {
  principal: Principal;
  requestId: string;
};

type TaskServiceOptions = {
  db: Database;
  now: () => Date;
};

export function createTaskService({ db, now }: TaskServiceOptions) {
  async function findActive(userId: string, id: string) {
    const [record] = await db
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.id, id),
          eq(reminders.userId, userId),
          eq(reminders.kind, "task"),
          isNull(reminders.deletedAt),
        ),
      )
      .limit(1);
    if (!record) throw new AppError("not_found", "The task was not found.");
    return record;
  }

  function assertScheduledTask(status: string, scheduledAt: Date | null) {
    if (status === "scheduled" && !scheduledAt) {
      throw new AppError("invalid_request", "A scheduled task requires a scheduled time.");
    }
  }

  return {
    async complete(id: string, completed: boolean, context: MutationContext): Promise<Task> {
      const before = await findActive(context.principal.userId, id);
      const timestamp = now();
      const after = await db.transaction(async (transaction) => {
        const updated = requireDatabaseRecord(
          (
            await transaction
              .update(reminders)
              .set({
                completedAt: completed ? timestamp : null,
                status: completed ? "completed" : "next",
                updatedAt: timestamp,
              })
              .where(eq(reminders.id, before.id))
              .returning()
          )[0],
          "The task could not be updated.",
        );
        await transaction.insert(auditEvents).values(
          auditValues({
            action: completed ? "task.completed" : "task.reopened",
            after: auditSnapshot(updated),
            before: auditSnapshot(before),
            entityId: updated.id,
            entityType: "task",
            ...context,
          }),
        );
        return updated;
      });
      return serializeTask(after);
    },

    async create(input: CreateTaskInput, context: MutationContext): Promise<Task> {
      const timestamp = now();
      const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
      assertScheduledTask(input.status, scheduledAt);
      const record = await db.transaction(async (transaction) => {
        const created = requireDatabaseRecord(
          (
            await transaction
              .insert(reminders)
              .values({
                completedAt: input.status === "completed" ? timestamp : null,
                dueAt: input.dueAt ? new Date(input.dueAt) : null,
                estimateMinutes: input.estimateMinutes,
                kind: "task",
                notes: input.notes,
                priority: input.priority,
                scheduledAt,
                status: input.status,
                tags: input.tags,
                timezone: input.timezone,
                title: input.title,
                userId: context.principal.userId,
              })
              .returning()
          )[0],
          "The task could not be created.",
        );
        await transaction.insert(auditEvents).values(
          auditValues({
            action: "task.created",
            after: auditSnapshot(created),
            before: null,
            entityId: created.id,
            entityType: "task",
            ...context,
          }),
        );
        return created;
      });
      return serializeTask(record);
    },

    async delete(id: string, context: MutationContext): Promise<void> {
      const before = await findActive(context.principal.userId, id);
      const timestamp = now();
      await db.transaction(async (transaction) => {
        const after = requireDatabaseRecord(
          (
            await transaction
              .update(reminders)
              .set({ deletedAt: timestamp, updatedAt: timestamp })
              .where(eq(reminders.id, before.id))
              .returning()
          )[0],
          "The task could not be deleted.",
        );
        await transaction.insert(auditEvents).values(
          auditValues({
            action: "task.deleted",
            after: auditSnapshot(after),
            before: auditSnapshot(before),
            entityId: after.id,
            entityType: "task",
            ...context,
          }),
        );
      });
    },

    async get(id: string, userId: string): Promise<Task> {
      return serializeTask(await findActive(userId, id));
    },

    async list(
      userId: string,
      query: TaskListQuery,
    ): Promise<{ items: Task[]; nextCursor: string | null }> {
      const conditions = [
        eq(reminders.userId, userId),
        eq(reminders.kind, "task"),
        isNull(reminders.deletedAt),
      ];
      if (query.completed !== undefined) {
        conditions.push(
          query.completed ? isNotNull(reminders.completedAt) : isNull(reminders.completedAt),
        );
      }
      if (query.status) conditions.push(eq(reminders.status, query.status));
      if (query.dueAfter) conditions.push(gte(reminders.dueAt, new Date(query.dueAfter)));
      if (query.dueBefore) conditions.push(lte(reminders.dueAt, new Date(query.dueBefore)));
      if (query.scheduledAfter)
        conditions.push(gte(reminders.scheduledAt, new Date(query.scheduledAfter)));
      if (query.scheduledBefore)
        conditions.push(lte(reminders.scheduledAt, new Date(query.scheduledBefore)));
      if (query.query) {
        const searchCondition = or(
          ilike(reminders.title, `%${query.query}%`),
          ilike(reminders.notes, `%${query.query}%`),
        );
        if (searchCondition) conditions.push(searchCondition);
      }
      if (query.cursor) {
        const cursor = decodeCursor(query.cursor);
        const cursorCondition = or(
          lt(reminders.createdAt, cursor.createdAt),
          and(eq(reminders.createdAt, cursor.createdAt), lt(reminders.id, cursor.id)),
        );
        if (cursorCondition) conditions.push(cursorCondition);
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
        items: page.map(serializeTask),
        nextCursor:
          hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
      };
    },

    async restore(id: string, context: MutationContext): Promise<Task> {
      const [before] = await db
        .select()
        .from(reminders)
        .where(
          and(
            eq(reminders.id, id),
            eq(reminders.userId, context.principal.userId),
            eq(reminders.kind, "task"),
            isNotNull(reminders.deletedAt),
          ),
        )
        .limit(1);
      if (!before) throw new AppError("not_found", "The deleted task was not found.");
      const after = await db.transaction(async (transaction) => {
        const restored = requireDatabaseRecord(
          (
            await transaction
              .update(reminders)
              .set({ deletedAt: null, updatedAt: now() })
              .where(eq(reminders.id, before.id))
              .returning()
          )[0],
          "The task could not be restored.",
        );
        await transaction.insert(auditEvents).values(
          auditValues({
            action: "task.restored",
            after: auditSnapshot(restored),
            before: auditSnapshot(before),
            entityId: restored.id,
            entityType: "task",
            ...context,
          }),
        );
        return restored;
      });
      return serializeTask(after);
    },

    async update(id: string, input: UpdateTaskInput, context: MutationContext): Promise<Task> {
      const before = await findActive(context.principal.userId, id);
      const nextStatus = input.status ?? before.status;
      const nextScheduledAt =
        input.scheduledAt === undefined
          ? before.scheduledAt
          : input.scheduledAt
            ? new Date(input.scheduledAt)
            : null;
      assertScheduledTask(nextStatus, nextScheduledAt);
      const timestamp = now();
      const after = await db.transaction(async (transaction) => {
        const updated = requireDatabaseRecord(
          (
            await transaction
              .update(reminders)
              .set({
                ...(input.dueAt === undefined
                  ? {}
                  : { dueAt: input.dueAt ? new Date(input.dueAt) : null }),
                ...(input.estimateMinutes === undefined
                  ? {}
                  : { estimateMinutes: input.estimateMinutes }),
                ...(input.notes === undefined ? {} : { notes: input.notes }),
                ...(input.priority === undefined ? {} : { priority: input.priority }),
                ...(input.scheduledAt === undefined ? {} : { scheduledAt: nextScheduledAt }),
                ...(input.status === undefined
                  ? {}
                  : {
                      completedAt:
                        input.status === "completed" ? (before.completedAt ?? timestamp) : null,
                      status: input.status,
                    }),
                ...(input.tags === undefined ? {} : { tags: input.tags }),
                ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
                ...(input.title === undefined ? {} : { title: input.title }),
                updatedAt: timestamp,
              })
              .where(eq(reminders.id, before.id))
              .returning()
          )[0],
          "The task could not be updated.",
        );
        await transaction.insert(auditEvents).values(
          auditValues({
            action: "task.updated",
            after: auditSnapshot(updated),
            before: auditSnapshot(before),
            entityId: updated.id,
            entityType: "task",
            ...context,
          }),
        );
        return updated;
      });
      return serializeTask(after);
    },
  };
}
