import { isDeepStrictEqual } from "node:util";
import {
  attentionItems,
  auditEvents,
  type Database,
  domainProfiles,
  reminders,
} from "@personal-os/database";
import {
  type AgentMutationPolicy,
  type AttentionItem,
  type CreateReminderInput,
  type Reminder,
  type ReminderDeferralPreview,
  type ReminderDeferralPreviewInput,
  type ReminderListQuery,
  reminderDraftProfilePreferencesSchema,
  reminderProfilePreferencesSchema,
  type UpdateReminderInput,
  type UpsertReminderAttentionItemInput,
} from "@personal-os/domain";
import { and, asc, desc, eq, gte, ilike, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { auditValues } from "./audit.js";
import { requireDatabaseRecord } from "./database.js";
import { AppError } from "./errors.js";
import { decodeCursor, encodeCursor } from "./pagination.js";
import { auditSnapshot, serializeReminder } from "./serialization.js";
import type { Principal } from "./types.js";

type MutationContext = {
  policy: AgentMutationPolicy;
  principal: Principal;
  requestId: string;
};

type ReminderServiceOptions = {
  db: Database;
  now: () => Date;
};

export function createReminderService({ db, now }: ReminderServiceOptions) {
  function auditAttentionState(
    row: typeof attentionItems.$inferSelect | null,
  ): Record<string, unknown> | null {
    if (!row) return null;
    return {
      domain: row.domain,
      importance: row.importance,
      kind: row.kind,
      relatedEntityId: row.relatedEntityId,
      relatedEntityType: row.relatedEntityType,
      source: row.source,
      status: row.status,
    };
  }

  function serializeAttentionItem(row: typeof attentionItems.$inferSelect): AttentionItem {
    return {
      createdAt: row.createdAt.toISOString(),
      domain: row.domain,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      id: row.id,
      importance: row.importance,
      kind: row.kind,
      occursAt: row.occursAt?.toISOString() ?? null,
      relatedEntityId: row.relatedEntityId,
      relatedEntityType: row.relatedEntityType,
      source: row.source,
      status: row.status,
      summary: row.summary,
      title: row.title,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  function auditState(
    row: typeof reminders.$inferSelect,
    context: MutationContext,
  ): Record<string, unknown> {
    return {
      ...auditSnapshot(row),
      authorization: {
        actorId: context.principal.actorId,
        kind:
          context.principal.actorType === "user" ? "interactive_user" : "scoped_agent_permission",
      },
      policy: context.policy,
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

  async function findCurrent(userId: string, id: string) {
    return (
      await db
        .select()
        .from(reminders)
        .where(
          and(eq(reminders.id, id), eq(reminders.userId, userId), eq(reminders.kind, "reminder")),
        )
        .limit(1)
    )[0];
  }

  function assertExpectedRevision(
    record: typeof reminders.$inferSelect,
    expectedUpdatedAt: string | undefined,
  ): void {
    if (expectedUpdatedAt && expectedUpdatedAt !== record.updatedAt.toISOString()) {
      throw new AppError("conflict", "The reminder changed since it was loaded.", {
        currentUpdatedAt: record.updatedAt.toISOString(),
      });
    }
  }

  function requireAgentRevision(
    context: MutationContext,
    expectedUpdatedAt: string | undefined,
  ): void {
    if (context.principal.actorType === "agent" && !expectedUpdatedAt) {
      throw new AppError(
        "invalid_request",
        "Agent Reminder mutations require expectedUpdatedAt from the current Reminder.",
      );
    }
  }

  function revisionConflict(currentUpdatedAt: string | null): AppError {
    return new AppError("conflict", "The reminder changed while the mutation was being applied.", {
      currentUpdatedAt,
    });
  }

  function nextUpdatedAt(previous: Date): Date {
    const current = now();
    return current.getTime() > previous.getTime() ? current : new Date(previous.getTime() + 1);
  }

  function matchesStoredRevision(revision: Date) {
    return sql`date_trunc('milliseconds', ${reminders.updatedAt}) = ${revision}`;
  }

  async function findActiveForMutation(
    userId: string,
    id: string,
    expectedUpdatedAt: string | undefined,
  ) {
    try {
      const record = await findActive(userId, id);
      assertExpectedRevision(record, expectedUpdatedAt);
      return record;
    } catch (error) {
      if (error instanceof AppError && error.code === "not_found" && expectedUpdatedAt) {
        const current = await findCurrent(userId, id);
        if (current) throw revisionConflict(current.updatedAt.toISOString());
      }
      throw error;
    }
  }

  return {
    async complete(
      id: string,
      completed: boolean,
      context: MutationContext,
      expectedUpdatedAt?: string,
    ): Promise<Reminder> {
      requireAgentRevision(context, expectedUpdatedAt);
      const before = await findActiveForMutation(context.principal.userId, id, expectedUpdatedAt);
      const after = await db.transaction(async (transaction) => {
        const [updated] = await transaction
          .update(reminders)
          .set({
            completedAt: completed ? now() : null,
            status: completed ? "completed" : "inbox",
            updatedAt: nextUpdatedAt(before.updatedAt),
          })
          .where(
            and(
              eq(reminders.id, before.id),
              eq(reminders.userId, before.userId),
              eq(reminders.kind, "reminder"),
              matchesStoredRevision(before.updatedAt),
              isNull(reminders.deletedAt),
            ),
          )
          .returning();
        if (!updated) {
          throw revisionConflict(null);
        }
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

    async delete(
      id: string,
      context: MutationContext,
      expectedUpdatedAt?: string,
    ): Promise<Reminder> {
      requireAgentRevision(context, expectedUpdatedAt);
      const before = await findActiveForMutation(context.principal.userId, id, expectedUpdatedAt);
      const deleted = await db.transaction(async (transaction) => {
        const deletedAt = now();
        const [after] = await transaction
          .update(reminders)
          .set({ deletedAt, updatedAt: nextUpdatedAt(before.updatedAt) })
          .where(
            and(
              eq(reminders.id, before.id),
              eq(reminders.userId, before.userId),
              eq(reminders.kind, "reminder"),
              matchesStoredRevision(before.updatedAt),
              isNull(reminders.deletedAt),
            ),
          )
          .returning();
        if (!after) {
          throw revisionConflict(null);
        }
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
        return after;
      });
      return serializeReminder(deleted);
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
      const previewedAt = now();
      if (new Date(input.overdueBefore).getTime() > previewedAt.getTime()) {
        throw new AppError("invalid_request", "The overdue cutoff cannot be in the future.");
      }
      if (new Date(input.proposedDueAt).getTime() <= previewedAt.getTime()) {
        throw new AppError(
          "invalid_request",
          "The proposed due time must be in the future when the preview is created.",
        );
      }
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

    async restore(
      id: string,
      context: MutationContext,
      expectedUpdatedAt?: string,
    ): Promise<Reminder> {
      requireAgentRevision(context, expectedUpdatedAt);
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
        const current = expectedUpdatedAt
          ? await findCurrent(context.principal.userId, id)
          : undefined;
        if (current) {
          throw revisionConflict(current.updatedAt.toISOString());
        }
        throw new AppError("not_found", "The deleted reminder was not found.");
      }
      assertExpectedRevision(before, expectedUpdatedAt);
      const after = await db.transaction(async (transaction) => {
        const [restored] = await transaction
          .update(reminders)
          .set({ deletedAt: null, updatedAt: nextUpdatedAt(before.updatedAt) })
          .where(
            and(
              eq(reminders.id, before.id),
              eq(reminders.userId, before.userId),
              eq(reminders.kind, "reminder"),
              matchesStoredRevision(before.updatedAt),
              isNotNull(reminders.deletedAt),
            ),
          )
          .returning();
        if (!restored) {
          throw revisionConflict(null);
        }
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
      requireAgentRevision(context, input.expectedUpdatedAt);
      const before = await findActiveForMutation(
        context.principal.userId,
        id,
        input.expectedUpdatedAt,
      );
      const after = await db.transaction(async (transaction) => {
        const [updated] = await transaction
          .update(reminders)
          .set({
            ...(input.dueAt === undefined
              ? {}
              : { dueAt: input.dueAt ? new Date(input.dueAt) : null }),
            ...(input.notes === undefined ? {} : { notes: input.notes }),
            ...(input.priority === undefined ? {} : { priority: input.priority }),
            ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
            ...(input.title === undefined ? {} : { title: input.title }),
            updatedAt: nextUpdatedAt(before.updatedAt),
          })
          .where(
            and(
              eq(reminders.id, before.id),
              eq(reminders.userId, before.userId),
              eq(reminders.kind, "reminder"),
              matchesStoredRevision(before.updatedAt),
              isNull(reminders.deletedAt),
            ),
          )
          .returning();
        if (!updated) {
          throw revisionConflict(null);
        }
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

    async upsertAttentionItem(
      reminderId: string,
      input: UpsertReminderAttentionItemInput,
      context: MutationContext,
    ): Promise<AttentionItem> {
      const saved = await db.transaction(async (transaction) => {
        const reminder = (
          await transaction
            .select()
            .from(reminders)
            .where(
              and(
                eq(reminders.id, reminderId),
                eq(reminders.userId, context.principal.userId),
                eq(reminders.kind, "reminder"),
                isNull(reminders.deletedAt),
              ),
            )
            .for("update")
            .limit(1)
        )[0];
        if (!reminder) throw new AppError("not_found", "The reminder was not found.");
        const existing = (
          await transaction
            .select()
            .from(attentionItems)
            .where(
              and(
                eq(attentionItems.userId, context.principal.userId),
                eq(attentionItems.domain, "reminders"),
                eq(attentionItems.relatedEntityId, reminder.id),
                eq(attentionItems.relatedEntityType, "reminder"),
                eq(attentionItems.kind, input.kind),
                eq(attentionItems.status, "open"),
              ),
            )
            .limit(1)
        )[0];
        const values = {
          domain: "reminders" as const,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          importance: input.importance,
          kind: input.kind,
          occursAt: input.occursAt ? new Date(input.occursAt) : null,
          relatedEntityId: reminder.id,
          relatedEntityType: "reminder",
          source: serializeReminder(reminder).source,
          status: "open" as const,
          summary: input.summary,
          title: input.title,
          userId: context.principal.userId,
        };
        const item = requireDatabaseRecord(
          (existing
            ? await transaction
                .update(attentionItems)
                .set({ ...values, updatedAt: now() })
                .where(eq(attentionItems.id, existing.id))
                .returning()
            : await transaction.insert(attentionItems).values(values).returning())[0],
          "The Reminder attention item could not be saved.",
        );
        await transaction.insert(auditEvents).values(
          auditValues({
            action: existing ? "assistant.attention.updated" : "assistant.attention.created",
            after: auditAttentionState(item),
            before: auditAttentionState(existing ?? null),
            entityId: item.id,
            entityType: "attention_item",
            ...context,
          }),
        );
        return item;
      });
      return serializeAttentionItem(saved);
    },

    async validateProfileSources(
      transaction: Pick<Database, "select">,
      userId: string,
      sourceIds: string[],
      status: "active" | "draft",
      preferences: Record<string, boolean | number | string | string[] | null>,
    ): Promise<Record<string, boolean | number | string | string[] | null>> {
      if (sourceIds.length > 0) {
        throw new AppError(
          "invalid_request",
          "Reminder setup uses Ilo's local Reminder collection and does not accept source contexts.",
        );
      }
      const schema =
        status === "draft"
          ? reminderDraftProfilePreferencesSchema
          : reminderProfilePreferencesSchema;
      const parsed = schema.safeParse(preferences);
      if (!parsed.success) {
        const existing =
          status === "active"
            ? (
                await transaction
                  .select({
                    preferences: domainProfiles.preferences,
                    status: domainProfiles.status,
                  })
                  .from(domainProfiles)
                  .where(
                    and(eq(domainProfiles.userId, userId), eq(domainProfiles.domain, "reminders")),
                  )
                  .limit(1)
              )[0]
            : undefined;
        if (existing?.status === "active" && isDeepStrictEqual(existing.preferences, preferences)) {
          return preferences;
        }
        throw new AppError(
          "invalid_request",
          status === "active"
            ? "An active Reminder profile requires the complete Reminder preference contract."
            : "The Reminder profile contains invalid preferences.",
          { issues: parsed.error.issues },
        );
      }
      return parsed.data;
    },
  };
}
