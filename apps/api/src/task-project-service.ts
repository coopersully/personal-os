import { createHash } from "node:crypto";
import {
  auditEvents,
  type Database,
  reminders,
  taskLists,
  taskProjects,
} from "@personal-os/database";
import {
  type ArchiveTaskProjectInput,
  type CancelTaskProjectInput,
  type CompleteTaskProjectInput,
  type CreateTaskProjectInput,
  type MoveTaskProjectInput,
  normalizeTaskContainerName,
  type TaskProject,
  type TaskProjectMovePreview,
  type TaskProjectMovePreviewInput,
  type UpdateTaskProjectInput,
} from "@personal-os/domain";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { auditValues } from "./audit.js";
import { requireDatabaseRecord } from "./database.js";
import { AppError, isUniqueViolation } from "./errors.js";
import { decodeCursor, encodeCursor } from "./pagination.js";
import { auditSnapshot, serializeTaskProject } from "./serialization.js";
import type { Principal } from "./types.js";

type MutationContext = {
  principal: Principal;
  requestId: string;
};

type TaskProjectServiceOptions = {
  db: Database;
  now: () => Date;
};

type TaskProjectQuery = {
  cursor?: string | undefined;
  limit: number;
};

type ProjectRow = typeof taskProjects.$inferSelect;
type TaskRow = typeof reminders.$inferSelect;
type ListRow = typeof taskLists.$inferSelect;
type DbTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

type MoveTaskTokenState = {
  deletedAt: string | null;
  id: string;
  lifecycle: string | null;
  listId: string | null;
  projectId: string | null;
  revision: number | null;
};

const completionResolutions = [
  "complete_open_tasks",
  "cancel_open_tasks",
  "move_open_tasks",
  "keep_project_open",
] as const;

export function createTaskProjectService({ db, now }: TaskProjectServiceOptions) {
  function projectAuditState(row: ProjectRow): Record<string, unknown> {
    return auditSnapshot(serializeTaskProject(row)) ?? {};
  }

  function taskAuditState(row: TaskRow): Record<string, unknown> {
    return (
      auditSnapshot({
        cancelledAt: row.taskCancelledAt?.toISOString() ?? null,
        completedAt: row.completedAt?.toISOString() ?? null,
        id: row.id,
        legacyStatus: row.status,
        lifecycle: row.taskLifecycle,
        listId: row.taskListId,
        projectId: row.taskProjectId,
        revision: row.taskRevision,
        source: {
          accountId: null,
          provider: "local",
          remoteId: row.id,
          revision: String(row.taskRevision),
          sourceType: "task",
        },
        updatedAt: row.updatedAt.toISOString(),
      }) ?? {}
    );
  }

  function createFingerprint(input: CreateTaskProjectInput, normalizedName: string): string {
    return createHash("sha256")
      .update(
        JSON.stringify({
          listId: input.listId,
          name: normalizedName,
          notes: input.notes,
          targetDate: input.targetDate,
          why: input.why,
        }),
      )
      .digest("hex");
  }

  function moveToken(input: {
    affectedTaskCount: number;
    affectedTasks: MoveTaskTokenState[];
    destinationListId: string;
    destinationListRevision: number;
    sourceListId: string;
    sourceListRevision: number;
    taskProjectId: string;
    taskProjectRevision: number;
  }): string {
    return createHash("sha256").update(JSON.stringify(input)).digest("hex");
  }

  function moveTaskTokenState(rows: TaskRow[]): MoveTaskTokenState[] {
    return rows
      .map((row) => ({
        deletedAt: row.deletedAt?.toISOString() ?? null,
        id: row.id,
        lifecycle: row.taskLifecycle,
        listId: row.taskListId,
        projectId: row.taskProjectId,
        revision: row.taskRevision,
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  async function lockLists(
    transaction: DbTransaction,
    userId: string,
    ids: string[],
  ): Promise<ListRow[]> {
    return transaction
      .select()
      .from(taskLists)
      .where(
        and(
          inArray(taskLists.id, [...new Set(ids)].sort()),
          eq(taskLists.userId, userId),
          isNull(taskLists.deletedAt),
        ),
      )
      .orderBy(taskLists.id)
      .for("update");
  }

  async function lockProjects(
    transaction: DbTransaction,
    userId: string,
    ids: string[],
  ): Promise<ProjectRow[]> {
    return transaction
      .select()
      .from(taskProjects)
      .where(
        and(
          inArray(taskProjects.id, [...new Set(ids)].sort()),
          eq(taskProjects.userId, userId),
          isNull(taskProjects.deletedAt),
        ),
      )
      .orderBy(taskProjects.id)
      .for("update");
  }

  function revisionConflict(currentRevision: number | null): AppError {
    return new AppError("conflict", "The task Project changed while the mutation was applied.", {
      currentRevision,
    });
  }

  function requireAgentRevision(context: MutationContext, expectedRevision?: number): void {
    if (context.principal.actorType === "agent" && expectedRevision === undefined) {
      throw new AppError(
        "invalid_request",
        "Agent task Project mutations require expectedRevision from the current Project.",
      );
    }
  }

  function assertExpectedRevision(row: ProjectRow, expectedRevision?: number): void {
    if (expectedRevision !== undefined && row.revision !== expectedRevision) {
      throw revisionConflict(row.revision);
    }
  }

  function assertMutableProject(row: ProjectRow): void {
    if (row.availability !== "active") {
      throw new AppError("conflict", "The task Project is archived.", {
        code: "task_project_archived",
        currentRevision: row.revision,
      });
    }
  }

  async function findCurrent(userId: string, id: string): Promise<ProjectRow> {
    const row = (
      await db
        .select()
        .from(taskProjects)
        .where(
          and(
            eq(taskProjects.id, id),
            eq(taskProjects.userId, userId),
            isNull(taskProjects.deletedAt),
          ),
        )
        .limit(1)
    )[0];
    if (!row) throw new AppError("not_found", "The task Project was not found.");
    return row;
  }

  async function findOwnedActiveList(userId: string, id: string): Promise<ListRow> {
    const row = (
      await db
        .select()
        .from(taskLists)
        .where(
          and(
            eq(taskLists.id, id),
            eq(taskLists.userId, userId),
            eq(taskLists.availability, "active"),
            isNull(taskLists.deletedAt),
          ),
        )
        .limit(1)
    )[0];
    if (!row) throw new AppError("not_found", "The destination task List was not found.");
    return row;
  }

  async function replayOrConflict(
    userId: string,
    idempotencyKey: string | undefined,
    fingerprint: string,
    listId: string,
    normalizedName: string,
  ): Promise<TaskProject> {
    if (idempotencyKey) {
      const replay = (
        await db
          .select()
          .from(taskProjects)
          .where(
            and(
              eq(taskProjects.userId, userId),
              eq(taskProjects.createIdempotencyKey, idempotencyKey),
              isNull(taskProjects.deletedAt),
            ),
          )
          .limit(1)
      )[0];
      if (replay) {
        if (replay.createIdempotencyFingerprint === fingerprint) {
          return serializeTaskProject(replay);
        }
        throw new AppError("conflict", "That idempotency key was used for another task Project.", {
          code: "task_project_idempotency_mismatch",
        });
      }
    }
    const collision = (
      await db
        .select({ id: taskProjects.id })
        .from(taskProjects)
        .where(
          and(
            eq(taskProjects.userId, userId),
            eq(taskProjects.listId, listId),
            eq(taskProjects.normalizedName, normalizedName),
            isNull(taskProjects.deletedAt),
          ),
        )
        .limit(1)
    )[0];
    if (collision) {
      throw new AppError("conflict", "A task Project with that name already exists in the List.", {
        code: "task_project_name_conflict",
      });
    }
    throw new AppError("conflict", "The task Project could not be created because it conflicts.");
  }

  async function insertTaskAudits(
    transaction: DbTransaction,
    beforeRows: TaskRow[],
    afterRows: TaskRow[],
    action: string,
    context: MutationContext,
  ): Promise<void> {
    const beforeById = new Map(beforeRows.map((row) => [row.id, row]));
    if (afterRows.length === 0) return;
    await transaction.insert(auditEvents).values(
      afterRows.map((after) => ({
        ...auditValues({
          action,
          after: taskAuditState(after),
          before: taskAuditState(
            requireDatabaseRecord(beforeById.get(after.id), "Task audit failed."),
          ),
          entityId: after.id,
          entityType: "task",
          ...context,
        }),
      })),
    );
  }

  return {
    async archive(
      id: string,
      input: ArchiveTaskProjectInput,
      context: MutationContext,
    ): Promise<TaskProject> {
      requireAgentRevision(context, input.expectedRevision);
      const row = await db.transaction(async (transaction) => {
        const before = (
          await transaction
            .select()
            .from(taskProjects)
            .where(
              and(
                eq(taskProjects.id, id),
                eq(taskProjects.userId, context.principal.userId),
                isNull(taskProjects.deletedAt),
              ),
            )
            .for("update")
        )[0];
        if (!before) throw new AppError("not_found", "The task Project was not found.");
        assertExpectedRevision(before, input.expectedRevision);
        assertMutableProject(before);
        const changedAt = now();
        const after = requireDatabaseRecord(
          (
            await transaction
              .update(taskProjects)
              .set({
                archivedAt: changedAt,
                availability: "archived",
                revision: before.revision + 1,
                updatedAt: changedAt,
              })
              .where(
                and(eq(taskProjects.id, before.id), eq(taskProjects.revision, before.revision)),
              )
              .returning()
          )[0],
          "The task Project could not be archived.",
        );
        await transaction.insert(auditEvents).values(
          auditValues({
            action: "task_project.archived",
            after: projectAuditState(after),
            before: projectAuditState(before),
            entityId: after.id,
            entityType: "task_project",
            ...context,
          }),
        );
        return after;
      });
      return serializeTaskProject(row);
    },

    async cancel(
      id: string,
      input: CancelTaskProjectInput,
      context: MutationContext,
    ): Promise<TaskProject> {
      requireAgentRevision(context, input.expectedRevision);
      const row = await db.transaction(async (transaction) => {
        const before = (
          await transaction
            .select()
            .from(taskProjects)
            .where(
              and(
                eq(taskProjects.id, id),
                eq(taskProjects.userId, context.principal.userId),
                isNull(taskProjects.deletedAt),
              ),
            )
            .for("update")
        )[0];
        if (!before) throw new AppError("not_found", "The task Project was not found.");
        assertExpectedRevision(before, input.expectedRevision);
        assertMutableProject(before);
        if (before.lifecycle !== "open") {
          throw new AppError("conflict", "Only an open task Project can be cancelled.", {
            code: "task_project_not_open",
            currentRevision: before.revision,
          });
        }
        const changedAt = now();
        const after = requireDatabaseRecord(
          (
            await transaction
              .update(taskProjects)
              .set({
                cancelledAt: changedAt,
                lifecycle: "cancelled",
                revision: before.revision + 1,
                updatedAt: changedAt,
              })
              .where(
                and(eq(taskProjects.id, before.id), eq(taskProjects.revision, before.revision)),
              )
              .returning()
          )[0],
          "The task Project could not be cancelled.",
        );
        await transaction.insert(auditEvents).values(
          auditValues({
            action: "task_project.cancelled",
            after: projectAuditState(after),
            before: projectAuditState(before),
            entityId: after.id,
            entityType: "task_project",
            ...context,
          }),
        );
        return after;
      });
      return serializeTaskProject(row);
    },

    async complete(
      id: string,
      input: CompleteTaskProjectInput,
      context: MutationContext,
    ): Promise<TaskProject> {
      requireAgentRevision(context, input.expectedRevision);
      const observed = await findCurrent(context.principal.userId, id);
      assertExpectedRevision(observed, input.expectedRevision);
      const row = await db.transaction(async (transaction) => {
        const lockedLists = await lockLists(
          transaction,
          observed.userId,
          [observed.listId, input.destinationListId].filter(
            (value): value is string => value !== undefined,
          ),
        );
        const lockedProjects = await lockProjects(transaction, observed.userId, [
          id,
          ...(input.resolution === "move_open_tasks" && input.destinationProjectId
            ? [input.destinationProjectId]
            : []),
        ]);
        const before = lockedProjects.find((project) => project.id === id);
        if (!before) throw new AppError("not_found", "The task Project was not found.");
        assertExpectedRevision(before, input.expectedRevision);
        if (before.listId !== observed.listId) throw revisionConflict(before.revision);
        assertMutableProject(before);
        if (before.lifecycle !== "open") {
          throw new AppError("conflict", "Only an open task Project can be completed.", {
            code: "task_project_not_open",
            currentRevision: before.revision,
          });
        }

        const sourceList = lockedLists.find((list) => list.id === before.listId);
        if (!sourceList) throw new AppError("not_found", "The source task List was not found.");
        const destinationList = input.destinationListId
          ? lockedLists.find((list) => list.id === input.destinationListId)
          : undefined;

        const openTasks = await transaction
          .select()
          .from(reminders)
          .where(
            and(
              eq(reminders.userId, before.userId),
              eq(reminders.kind, "task"),
              eq(reminders.taskProjectId, before.id),
              eq(reminders.taskLifecycle, "open"),
              isNull(reminders.deletedAt),
            ),
          )
          .orderBy(reminders.id)
          .for("update");

        if (openTasks.length > 0 && input.resolution === undefined) {
          throw new AppError("conflict", "The task Project still has open Tasks.", {
            code: "task_project_has_open_tasks",
            currentRevisions: {
              destinationList: destinationList?.revision ?? null,
              project: before.revision,
              sourceList: sourceList.revision,
              task: null,
            },
            openContentCounts: { projects: 0, tasks: openTasks.length },
            resolutions: completionResolutions,
          });
        }
        if (input.resolution === "keep_project_open") return before;

        let destinationProject: ProjectRow | undefined;
        if (input.resolution === "move_open_tasks") {
          if (destinationList?.availability !== "active") {
            throw new AppError("not_found", "The destination task List was not found.");
          }
          if (input.destinationProjectId === before.id) {
            throw new AppError(
              "conflict",
              "Open Tasks cannot move back into the Project being completed.",
              { code: "task_project_destination_unavailable" },
            );
          }
          if (input.destinationProjectId) {
            destinationProject = lockedProjects.find(
              (project) =>
                project.id === input.destinationProjectId &&
                project.listId === destinationList.id &&
                project.lifecycle === "open" &&
                project.availability === "active",
            );
            if (destinationProject === undefined) {
              throw new AppError("not_found", "The destination task Project was not found.");
            }
          }
        }

        const changedAt = now();
        let changedTasks: TaskRow[] = [];
        let taskAction = "";
        if (openTasks.length > 0 && input.resolution === "complete_open_tasks") {
          changedTasks = await transaction
            .update(reminders)
            .set({
              completedAt: changedAt,
              status: "completed",
              taskLifecycle: "completed",
              taskRevision: sql<number>`${reminders.taskRevision} + 1`,
              updatedAt: changedAt,
            })
            .where(
              inArray(
                reminders.id,
                openTasks.map(({ id: taskId }) => taskId),
              ),
            )
            .returning();
          taskAction = "task.completed_with_project";
        } else if (openTasks.length > 0 && input.resolution === "cancel_open_tasks") {
          changedTasks = await transaction
            .update(reminders)
            .set({
              completedAt: null,
              status: "cancelled",
              taskCancelledAt: changedAt,
              taskLifecycle: "cancelled",
              taskRevision: sql<number>`${reminders.taskRevision} + 1`,
              updatedAt: changedAt,
            })
            .where(
              inArray(
                reminders.id,
                openTasks.map(({ id: taskId }) => taskId),
              ),
            )
            .returning();
          taskAction = "task.cancelled_with_project";
        } else if (openTasks.length > 0 && input.resolution === "move_open_tasks") {
          changedTasks = await transaction
            .update(reminders)
            .set({
              taskListId: destinationList?.id,
              taskProjectId: destinationProject?.id ?? null,
              taskRevision: sql<number>`${reminders.taskRevision} + 1`,
              updatedAt: changedAt,
            })
            .where(
              inArray(
                reminders.id,
                openTasks.map(({ id: taskId }) => taskId),
              ),
            )
            .returning();
          taskAction = "task.moved_from_completed_project";
        }

        const after = requireDatabaseRecord(
          (
            await transaction
              .update(taskProjects)
              .set({
                completedAt: changedAt,
                lifecycle: "completed",
                revision: before.revision + 1,
                updatedAt: changedAt,
              })
              .where(
                and(eq(taskProjects.id, before.id), eq(taskProjects.revision, before.revision)),
              )
              .returning()
          )[0],
          "The task Project could not be completed.",
        );
        await insertTaskAudits(transaction, openTasks, changedTasks, taskAction, context);
        await transaction.insert(auditEvents).values(
          auditValues({
            action: "task_project.completed",
            after: projectAuditState(after),
            before: projectAuditState(before),
            entityId: after.id,
            entityType: "task_project",
            ...context,
          }),
        );
        return after;
      });
      return serializeTaskProject(row);
    },

    async create(input: CreateTaskProjectInput, context: MutationContext): Promise<TaskProject> {
      if (context.principal.actorType === "agent" && !input.idempotencyKey) {
        throw new AppError(
          "invalid_request",
          "Agent task Project creates require an idempotency key.",
        );
      }
      const normalizedName = normalizeTaskContainerName(input.name);
      const fingerprint = createFingerprint(input, normalizedName);
      try {
        const row = await db.transaction(async (transaction) => {
          const destination = (
            await transaction
              .select({ id: taskLists.id })
              .from(taskLists)
              .where(
                and(
                  eq(taskLists.id, input.listId),
                  eq(taskLists.userId, context.principal.userId),
                  eq(taskLists.availability, "active"),
                  isNull(taskLists.deletedAt),
                ),
              )
              .for("share")
          )[0];
          if (!destination) {
            throw new AppError("not_found", "The destination task List was not found.");
          }
          const created = requireDatabaseRecord(
            (
              await transaction
                .insert(taskProjects)
                .values({
                  createIdempotencyFingerprint: input.idempotencyKey ? fingerprint : null,
                  createIdempotencyKey: input.idempotencyKey ?? null,
                  listId: input.listId,
                  name: input.name,
                  normalizedName,
                  notes: input.notes,
                  targetDate: input.targetDate,
                  userId: context.principal.userId,
                  why: input.why,
                })
                .returning()
            )[0],
            "The task Project could not be created.",
          );
          await transaction.insert(auditEvents).values(
            auditValues({
              action: "task_project.created",
              after: projectAuditState(created),
              before: null,
              entityId: created.id,
              entityType: "task_project",
              ...context,
            }),
          );
          return created;
        });
        return serializeTaskProject(row);
      } catch (error) {
        if (isUniqueViolation(error)) {
          return replayOrConflict(
            context.principal.userId,
            input.idempotencyKey,
            fingerprint,
            input.listId,
            normalizedName,
          );
        }
        throw error;
      }
    },

    async get(id: string, userId: string): Promise<TaskProject> {
      return serializeTaskProject(await findCurrent(userId, id));
    },

    async list(
      userId: string,
      query: TaskProjectQuery,
    ): Promise<{ items: TaskProject[]; nextCursor: string | null }> {
      const conditions = [eq(taskProjects.userId, userId), isNull(taskProjects.deletedAt)];
      if (query.cursor) {
        const cursor = decodeCursor(query.cursor);
        const cursorCondition = or(
          lt(taskProjects.createdAt, cursor.createdAt),
          and(eq(taskProjects.createdAt, cursor.createdAt), lt(taskProjects.id, cursor.id)),
        );
        if (cursorCondition) conditions.push(cursorCondition);
      }
      const rows = await db
        .select()
        .from(taskProjects)
        .where(and(...conditions))
        .orderBy(desc(taskProjects.createdAt), desc(taskProjects.id))
        .limit(query.limit + 1);
      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;
      const last = page.at(-1);
      return {
        items: page.map(serializeTaskProject),
        nextCursor:
          hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
      };
    },

    async move(
      id: string,
      input: MoveTaskProjectInput,
      context: MutationContext,
    ): Promise<TaskProject> {
      requireAgentRevision(context, input.expectedRevision);
      const observed = await findCurrent(context.principal.userId, id);
      assertExpectedRevision(observed, input.expectedRevision);
      try {
        const row = await db.transaction(async (transaction) => {
          const lists = await lockLists(transaction, observed.userId, [
            observed.listId,
            input.destinationListId,
          ]);
          const before = (await lockProjects(transaction, observed.userId, [id]))[0];
          if (!before) throw new AppError("not_found", "The task Project was not found.");
          assertExpectedRevision(before, input.expectedRevision);
          if (before.listId !== observed.listId) throw revisionConflict(before.revision);
          assertMutableProject(before);

          const source = lists.find((list) => list.id === before.listId);
          const destination = lists.find((list) => list.id === input.destinationListId);
          if (!source) throw new AppError("not_found", "The source task List was not found.");
          if (destination?.availability !== "active") {
            throw new AppError("not_found", "The destination task List was not found.");
          }
          if (source.id === destination.id) {
            throw new AppError("conflict", "Choose another active destination task List.", {
              code: "task_project_destination_unavailable",
            });
          }

          const beforeTasks = await transaction
            .select()
            .from(reminders)
            .where(
              and(
                eq(reminders.userId, before.userId),
                eq(reminders.kind, "task"),
                eq(reminders.taskProjectId, before.id),
              ),
            )
            .orderBy(reminders.id)
            .for("update");
          const previewValues = {
            affectedTaskCount: beforeTasks.length,
            affectedTasks: moveTaskTokenState(beforeTasks),
            destinationListId: destination.id,
            destinationListRevision: destination.revision,
            sourceListId: source.id,
            sourceListRevision: source.revision,
            taskProjectId: before.id,
            taskProjectRevision: before.revision,
          };
          if (moveToken(previewValues) !== input.previewToken) {
            throw new AppError("conflict", "The task Project move preview is stale.", {
              code: "task_project_move_preview_stale",
              currentRevision: before.revision,
            });
          }

          const changedAt = now();
          if (beforeTasks.length > 0) {
            await transaction
              .update(reminders)
              .set({ taskProjectId: null })
              .where(
                inArray(
                  reminders.id,
                  beforeTasks.map(({ id: taskId }) => taskId),
                ),
              );
          }
          const after = requireDatabaseRecord(
            (
              await transaction
                .update(taskProjects)
                .set({
                  listId: destination.id,
                  revision: before.revision + 1,
                  updatedAt: changedAt,
                })
                .where(
                  and(eq(taskProjects.id, before.id), eq(taskProjects.revision, before.revision)),
                )
                .returning()
            )[0],
            "The task Project could not be moved.",
          );
          const afterTasks =
            beforeTasks.length === 0
              ? []
              : await transaction
                  .update(reminders)
                  .set({
                    taskListId: destination.id,
                    taskProjectId: before.id,
                    taskRevision: sql<number>`${reminders.taskRevision} + 1`,
                    updatedAt: changedAt,
                  })
                  .where(
                    inArray(
                      reminders.id,
                      beforeTasks.map(({ id: taskId }) => taskId),
                    ),
                  )
                  .returning();
          await insertTaskAudits(
            transaction,
            beforeTasks,
            afterTasks,
            "task.moved_with_project",
            context,
          );
          await transaction.insert(auditEvents).values(
            auditValues({
              action: "task_project.moved",
              after: projectAuditState(after),
              before: projectAuditState(before),
              entityId: after.id,
              entityType: "task_project",
              ...context,
            }),
          );
          return after;
        });
        return serializeTaskProject(row);
      } catch (error) {
        if (isUniqueViolation(error, "task_projects_active_name_idx")) {
          throw new AppError(
            "conflict",
            "Moving the task Project would create a duplicate name in the destination List.",
            { code: "task_project_move_name_conflict" },
          );
        }
        throw error;
      }
    },

    async previewMove(
      id: string,
      input: TaskProjectMovePreviewInput,
      context: MutationContext,
    ): Promise<TaskProjectMovePreview> {
      requireAgentRevision(context, input.expectedRevision);
      const project = await findCurrent(context.principal.userId, id);
      assertExpectedRevision(project, input.expectedRevision);
      assertMutableProject(project);
      const [source, destination] = await Promise.all([
        findOwnedActiveList(project.userId, project.listId),
        findOwnedActiveList(project.userId, input.destinationListId),
      ]);
      if (source.id === destination.id) {
        throw new AppError("conflict", "Choose another active destination task List.", {
          code: "task_project_destination_unavailable",
        });
      }
      const affectedTasks = await db
        .select()
        .from(reminders)
        .where(
          and(
            eq(reminders.userId, project.userId),
            eq(reminders.kind, "task"),
            eq(reminders.taskProjectId, project.id),
          ),
        )
        .orderBy(reminders.id);
      const tokenValues = {
        affectedTaskCount: affectedTasks.length,
        affectedTasks: moveTaskTokenState(affectedTasks),
        destinationListId: destination.id,
        destinationListRevision: destination.revision,
        sourceListId: source.id,
        sourceListRevision: source.revision,
        taskProjectId: project.id,
        taskProjectRevision: project.revision,
      };
      const { affectedTasks: _, ...preview } = tokenValues;
      return { ...preview, previewToken: moveToken(tokenValues) };
    },

    async update(
      id: string,
      input: UpdateTaskProjectInput,
      context: MutationContext,
    ): Promise<TaskProject> {
      requireAgentRevision(context, input.expectedRevision);
      try {
        const row = await db.transaction(async (transaction) => {
          const before = (
            await transaction
              .select()
              .from(taskProjects)
              .where(
                and(
                  eq(taskProjects.id, id),
                  eq(taskProjects.userId, context.principal.userId),
                  isNull(taskProjects.deletedAt),
                ),
              )
              .for("update")
          )[0];
          if (!before) throw new AppError("not_found", "The task Project was not found.");
          assertExpectedRevision(before, input.expectedRevision);
          assertMutableProject(before);
          const normalizedName =
            input.name === undefined
              ? before.normalizedName
              : normalizeTaskContainerName(input.name);
          const changedAt = now();
          const after = requireDatabaseRecord(
            (
              await transaction
                .update(taskProjects)
                .set({
                  ...(input.name === undefined ? {} : { name: input.name, normalizedName }),
                  ...(input.notes === undefined ? {} : { notes: input.notes }),
                  ...(input.targetDate === undefined ? {} : { targetDate: input.targetDate }),
                  ...(input.why === undefined ? {} : { why: input.why }),
                  revision: before.revision + 1,
                  updatedAt: changedAt,
                })
                .where(
                  and(eq(taskProjects.id, before.id), eq(taskProjects.revision, before.revision)),
                )
                .returning()
            )[0],
            "The task Project could not be updated.",
          );
          await transaction.insert(auditEvents).values(
            auditValues({
              action: "task_project.updated",
              after: projectAuditState(after),
              before: projectAuditState(before),
              entityId: after.id,
              entityType: "task_project",
              ...context,
            }),
          );
          return after;
        });
        return serializeTaskProject(row);
      } catch (error) {
        if (isUniqueViolation(error, "task_projects_active_name_idx")) {
          throw new AppError(
            "conflict",
            "A task Project with that name already exists in the List.",
            {
              code: "task_project_name_conflict",
            },
          );
        }
        throw error;
      }
    },
  };
}
