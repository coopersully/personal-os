import { createHash } from "node:crypto";
import {
  auditEvents,
  type Database,
  reminders,
  taskLists,
  taskProjects,
} from "@personal-os/database";
import {
  type ArchiveTaskListInput,
  type CreateTaskListInput,
  normalizeTaskContainerName,
  reservedTaskListNames,
  type TaskList,
  type UpdateTaskListInput,
} from "@personal-os/domain";
import { and, count, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { auditValues } from "./audit.js";
import { requireDatabaseRecord } from "./database.js";
import { AppError, isUniqueViolation } from "./errors.js";
import { decodeCursor, encodeCursor } from "./pagination.js";
import { auditSnapshot, serializeTaskList } from "./serialization.js";
import type { Principal } from "./types.js";

type MutationContext = {
  principal: Principal;
  requestId: string;
};

type TaskListServiceOptions = {
  db: Database;
  now: () => Date;
};

type TaskListQuery = {
  cursor?: string | undefined;
  limit: number;
};

const inboxResolutions = ["keep_inbox", "choose_another_list"] as const;
const archiveResolutions = ["move_active_contents", "archive_contents_together", "cancel"] as const;

export function createTaskListService({ db, now }: TaskListServiceOptions) {
  function fingerprint(input: CreateTaskListInput, normalizedName: string): string {
    return createHash("sha256")
      .update(
        JSON.stringify({
          color: input.color,
          description: input.description,
          name: normalizedName,
          source: input.source,
        }),
      )
      .digest("hex");
  }

  function auditState(row: typeof taskLists.$inferSelect): Record<string, unknown> {
    return auditSnapshot(serializeTaskList(row)) ?? {};
  }

  function revisionConflict(currentRevision: number | null): AppError {
    return new AppError("conflict", "The task List changed while the mutation was applied.", {
      currentRevision,
    });
  }

  function inboxConflict(currentRevision: number): AppError {
    return new AppError("conflict", "The Inbox is a protected system List.", {
      code: "task_list_inbox_protected",
      currentRevision,
      resolutions: inboxResolutions,
    });
  }

  function requireAgentRevision(context: MutationContext, expectedRevision?: number): void {
    if (context.principal.actorType === "agent" && expectedRevision === undefined) {
      throw new AppError(
        "invalid_request",
        "Agent task List mutations require expectedRevision from the current List.",
      );
    }
  }

  function assertExpectedRevision(
    row: typeof taskLists.$inferSelect,
    expectedRevision?: number,
  ): void {
    if (expectedRevision !== undefined && expectedRevision !== row.revision) {
      throw revisionConflict(row.revision);
    }
  }

  function assertAvailableName(normalizedName: string): void {
    if (reservedTaskListNames.has(normalizedName as never)) {
      throw new AppError("conflict", "That name is reserved for a Task view.", {
        code: "task_list_reserved_name",
      });
    }
  }

  async function findCurrent(userId: string, id: string) {
    const row = (
      await db
        .select()
        .from(taskLists)
        .where(and(eq(taskLists.id, id), eq(taskLists.userId, userId), isNull(taskLists.deletedAt)))
        .limit(1)
    )[0];
    if (!row) throw new AppError("not_found", "The task List was not found.");
    return row;
  }

  async function throwCurrentRevisionConflict(
    transaction: Pick<Database, "select">,
    userId: string,
    id: string,
  ): Promise<never> {
    const current = (
      await transaction
        .select({ revision: taskLists.revision })
        .from(taskLists)
        .where(and(eq(taskLists.id, id), eq(taskLists.userId, userId), isNull(taskLists.deletedAt)))
        .limit(1)
    )[0];
    throw revisionConflict(current?.revision ?? null);
  }

  async function replayOrNameConflict(
    userId: string,
    idempotencyKey: string | undefined,
    expectedFingerprint: string,
    normalizedName: string,
  ): Promise<TaskList> {
    if (idempotencyKey) {
      const replay = (
        await db
          .select()
          .from(taskLists)
          .where(
            and(
              eq(taskLists.userId, userId),
              eq(taskLists.createIdempotencyKey, idempotencyKey),
              isNull(taskLists.deletedAt),
            ),
          )
          .limit(1)
      )[0];
      if (replay) {
        if (replay.createIdempotencyFingerprint === expectedFingerprint) {
          return serializeTaskList(replay);
        }
        throw new AppError("conflict", "That idempotency key was used for another task List.", {
          code: "task_list_idempotency_mismatch",
        });
      }
    }
    const collision = (
      await db
        .select({ id: taskLists.id })
        .from(taskLists)
        .where(
          and(
            eq(taskLists.userId, userId),
            eq(taskLists.normalizedName, normalizedName),
            isNull(taskLists.deletedAt),
          ),
        )
        .limit(1)
    )[0];
    if (collision) {
      throw new AppError("conflict", "A task List with that name already exists.", {
        code: "task_list_name_conflict",
      });
    }
    throw new AppError("conflict", "The task List could not be created because it conflicts.");
  }

  return {
    async archive(
      id: string,
      input: ArchiveTaskListInput,
      context: MutationContext,
    ): Promise<TaskList> {
      requireAgentRevision(context, input.expectedRevision);
      try {
        const row = await db.transaction(async (transaction) => {
          const requestedIds = input.destinationListId
            ? [id, input.destinationListId].sort()
            : [id];
          const locked = await transaction
            .select()
            .from(taskLists)
            .where(
              and(
                inArray(taskLists.id, requestedIds),
                eq(taskLists.userId, context.principal.userId),
                isNull(taskLists.deletedAt),
              ),
            )
            .orderBy(taskLists.id)
            .for("update");
          const source = locked.find((item) => item.id === id);
          if (!source) throw new AppError("not_found", "The task List was not found.");
          assertExpectedRevision(source, input.expectedRevision);
          if (source.kind === "inbox") throw inboxConflict(source.revision);
          if (source.availability === "archived") {
            throw new AppError("conflict", "The task List is already archived.", {
              code: "task_list_already_archived",
              currentRevision: source.revision,
            });
          }
          if (input.resolution === "cancel") return source;

          const destination = input.destinationListId
            ? locked.find((item) => item.id === input.destinationListId)
            : undefined;
          if (input.resolution === "move_active_contents") {
            if (!destination) {
              throw new AppError("not_found", "The destination task List was not found.");
            }
            if (destination.id === source.id || destination.availability !== "active") {
              throw new AppError("conflict", "Choose another active destination task List.", {
                code: "task_list_destination_unavailable",
                currentRevision: destination.revision,
              });
            }
          }

          const [[projectCount], [taskCount]] = await Promise.all([
            transaction
              .select({ value: count() })
              .from(taskProjects)
              .where(
                and(
                  eq(taskProjects.userId, source.userId),
                  eq(taskProjects.listId, source.id),
                  eq(taskProjects.lifecycle, "open"),
                  eq(taskProjects.availability, "active"),
                  isNull(taskProjects.deletedAt),
                ),
              ),
            transaction
              .select({ value: count() })
              .from(reminders)
              .where(
                and(
                  eq(reminders.userId, source.userId),
                  eq(reminders.kind, "task"),
                  eq(reminders.taskListId, source.id),
                  eq(reminders.taskLifecycle, "open"),
                  isNull(reminders.deletedAt),
                ),
              ),
          ]);
          const openContentCounts = {
            projects: projectCount?.value ?? 0,
            tasks: taskCount?.value ?? 0,
          };
          const hasContents = openContentCounts.projects > 0 || openContentCounts.tasks > 0;
          if (hasContents && input.resolution === undefined) {
            throw new AppError("conflict", "The task List still has active contents.", {
              code: "task_list_has_active_contents",
              currentRevisions: {
                destinationList: destination?.revision ?? null,
                project: null,
                sourceList: source.revision,
                task: null,
              },
              openContentCounts,
              resolutions: archiveResolutions,
            });
          }

          const changedAt = now();
          if (hasContents && input.resolution === "move_active_contents" && destination) {
            await transaction.execute(sql`
              WITH moved_projects AS (
                UPDATE "task_projects"
                SET "list_id" = ${destination.id},
                    "revision" = "revision" + 1,
                    "updated_at" = ${changedAt}
                WHERE "user_id" = ${source.userId}
                  AND "list_id" = ${source.id}
                RETURNING "id"
              ), moved_tasks AS (
                UPDATE "reminders"
                SET "task_list_id" = ${destination.id},
                    "task_revision" = "task_revision" + 1,
                    "updated_at" = ${changedAt}
                WHERE "user_id" = ${source.userId}
                  AND "kind" = 'task'
                  AND "task_list_id" = ${source.id}
                RETURNING "id"
              )
              SELECT
                (SELECT count(*) FROM moved_projects) AS "project_count",
                (SELECT count(*) FROM moved_tasks) AS "task_count"
            `);
          }

          const expectedRevision = input.expectedRevision ?? source.revision;
          const updated = (
            await transaction
              .update(taskLists)
              .set({
                archivedAt: changedAt,
                availability: "archived",
                revision: source.revision + 1,
                updatedAt: changedAt,
              })
              .where(
                and(
                  eq(taskLists.id, source.id),
                  eq(taskLists.userId, source.userId),
                  eq(taskLists.revision, expectedRevision),
                  isNull(taskLists.deletedAt),
                ),
              )
              .returning()
          )[0];
          if (!updated) {
            return throwCurrentRevisionConflict(transaction, source.userId, source.id);
          }
          await transaction.insert(auditEvents).values(
            auditValues({
              action: "task_list.archived",
              after: auditState(updated),
              before: auditState(source),
              entityId: updated.id,
              entityType: "task_list",
              ...context,
            }),
          );
          return updated;
        });
        return serializeTaskList(row);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new AppError(
            "conflict",
            "Moving the task List contents would create a duplicate Project name.",
            { code: "task_list_move_name_conflict" },
          );
        }
        throw error;
      }
    },

    async create(input: CreateTaskListInput, context: MutationContext): Promise<TaskList> {
      if (context.principal.actorType === "agent" && !input.idempotencyKey) {
        throw new AppError(
          "invalid_request",
          "Agent task List creates require an idempotency key.",
        );
      }
      const normalizedName = normalizeTaskContainerName(input.name);
      assertAvailableName(normalizedName);
      const createFingerprint = fingerprint(input, normalizedName);
      try {
        const created = await db.transaction(async (transaction) => {
          const row = requireDatabaseRecord(
            (
              await transaction
                .insert(taskLists)
                .values({
                  color: input.color,
                  createIdempotencyFingerprint: input.idempotencyKey ? createFingerprint : null,
                  createIdempotencyKey: input.idempotencyKey ?? null,
                  description: input.description,
                  kind: "standard",
                  name: input.name,
                  normalizedName,
                  userId: context.principal.userId,
                })
                .returning()
            )[0],
            "The task List could not be created.",
          );
          await transaction.insert(auditEvents).values(
            auditValues({
              action: "task_list.created",
              after: auditState(row),
              before: null,
              entityId: row.id,
              entityType: "task_list",
              ...context,
            }),
          );
          return row;
        });
        return serializeTaskList(created);
      } catch (error) {
        if (isUniqueViolation(error)) {
          return replayOrNameConflict(
            context.principal.userId,
            input.idempotencyKey,
            createFingerprint,
            normalizedName,
          );
        }
        throw error;
      }
    },

    async get(id: string, userId: string): Promise<TaskList> {
      return serializeTaskList(await findCurrent(userId, id));
    },

    async list(
      userId: string,
      query: TaskListQuery,
    ): Promise<{ items: TaskList[]; nextCursor: string | null }> {
      const conditions = [eq(taskLists.userId, userId), isNull(taskLists.deletedAt)];
      if (query.cursor) {
        const cursor = decodeCursor(query.cursor);
        const cursorCondition = or(
          lt(taskLists.createdAt, cursor.createdAt),
          and(eq(taskLists.createdAt, cursor.createdAt), lt(taskLists.id, cursor.id)),
        );
        if (cursorCondition) conditions.push(cursorCondition);
      }
      const rows = await db
        .select()
        .from(taskLists)
        .where(and(...conditions))
        .orderBy(desc(taskLists.createdAt), desc(taskLists.id))
        .limit(query.limit + 1);
      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;
      const last = page.at(-1);
      return {
        items: page.map(serializeTaskList),
        nextCursor:
          hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
      };
    },

    async update(
      id: string,
      input: UpdateTaskListInput,
      context: MutationContext,
    ): Promise<TaskList> {
      requireAgentRevision(context, input.expectedRevision);
      const before = await findCurrent(context.principal.userId, id);
      assertExpectedRevision(before, input.expectedRevision);
      if (before.kind === "inbox") throw inboxConflict(before.revision);
      const normalizedName =
        input.name === undefined ? before.normalizedName : normalizeTaskContainerName(input.name);
      if (input.name !== undefined) assertAvailableName(normalizedName);
      try {
        const updated = await db.transaction(async (transaction) => {
          const expectedRevision = input.expectedRevision ?? before.revision;
          const row = (
            await transaction
              .update(taskLists)
              .set({
                ...(input.color === undefined ? {} : { color: input.color }),
                ...(input.description === undefined ? {} : { description: input.description }),
                ...(input.name === undefined ? {} : { name: input.name, normalizedName }),
                revision: before.revision + 1,
                updatedAt: now(),
              })
              .where(
                and(
                  eq(taskLists.id, before.id),
                  eq(taskLists.userId, before.userId),
                  eq(taskLists.revision, expectedRevision),
                  isNull(taskLists.deletedAt),
                ),
              )
              .returning()
          )[0];
          if (!row) return throwCurrentRevisionConflict(transaction, before.userId, before.id);
          await transaction.insert(auditEvents).values(
            auditValues({
              action: "task_list.updated",
              after: auditState(row),
              before: auditState(before),
              entityId: row.id,
              entityType: "task_list",
              ...context,
            }),
          );
          return row;
        });
        return serializeTaskList(updated);
      } catch (error) {
        if (isUniqueViolation(error, "task_lists_active_name_idx")) {
          throw new AppError("conflict", "A task List with that name already exists.", {
            code: "task_list_name_conflict",
          });
        }
        throw error;
      }
    },
  };
}
