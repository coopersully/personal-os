import { createHash } from "node:crypto";
import {
  auditEvents,
  type Database,
  reminders,
  taskLists,
  taskProjects,
  users,
} from "@personal-os/database";
import {
  type CancelTaskInput,
  type CompleteTaskInput,
  type CreateTaskInput,
  localDayRange,
  type MoveTaskInput,
  type ReopenTaskInput,
  type RestoreTaskInput,
  type Task,
  type TaskListQuery,
  type TaskMovePreview,
  type TaskMovePreviewInput,
  type TrashTaskInput,
  type UpdateTaskInput,
} from "@personal-os/domain";
import { and, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import { auditValues } from "./audit.js";
import { requireDatabaseRecord } from "./database.js";
import { AppError, isUniqueViolation } from "./errors.js";
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

type TaskRow = typeof reminders.$inferSelect;
type ListRow = typeof taskLists.$inferSelect;
type ProjectRow = typeof taskProjects.$inferSelect;
type DbTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

type LockedTaskHierarchy = {
  destinationList: ListRow | null;
  destinationProject: ProjectRow | null;
  sourceList: ListRow;
  sourceProject: ProjectRow | null;
  task: TaskRow;
};

export function createTaskService({ db, now }: TaskServiceOptions) {
  function taskAuditState(row: TaskRow): Record<string, unknown> {
    return auditSnapshot(serializeTask(row)) ?? {};
  }

  function projectedLegacyStatus(
    lifecycle: NonNullable<TaskRow["taskLifecycle"]>,
    scheduledAt: Date | null,
  ): TaskRow["status"] {
    if (lifecycle === "completed") return "completed";
    if (lifecycle === "cancelled") return "cancelled";
    return scheduledAt ? "scheduled" : "inbox";
  }

  function revisionConflict(currentRevision: number | null): AppError {
    return new AppError("conflict", "The Task changed while the mutation was applied.", {
      currentRevision,
    });
  }

  function requireAgentRevision(context: MutationContext, expectedRevision?: number): void {
    if (context.principal.actorType === "agent" && expectedRevision === undefined) {
      throw new AppError(
        "invalid_request",
        "Agent Task mutations require expectedRevision from the current Task.",
      );
    }
  }

  function assertExpectedRevision(row: TaskRow, expectedRevision?: number): void {
    if (expectedRevision !== undefined && row.taskRevision !== expectedRevision) {
      throw revisionConflict(row.taskRevision);
    }
  }

  function assertCanonicalTask(row: TaskRow): asserts row is TaskRow & {
    taskLifecycle: NonNullable<TaskRow["taskLifecycle"]>;
    taskListId: string;
    taskRevision: number;
  } {
    if (row.taskListId === null || row.taskLifecycle === null || row.taskRevision === null) {
      throw new AppError("internal_error", "The stored Task is missing canonical fields.");
    }
  }

  function createFingerprint(input: CreateTaskInput, listId: string): string {
    return createHash("sha256")
      .update(
        JSON.stringify({
          dueAt: input.dueAt,
          estimateMinutes: input.estimateMinutes,
          lifecycle: input.lifecycle,
          listId,
          notes: input.notes,
          priority: input.priority,
          projectId: input.projectId ?? null,
          scheduledAt: input.scheduledAt,
          tags: input.tags,
          timezone: input.timezone,
          title: input.title,
          why: input.why,
        }),
      )
      .digest("hex");
  }

  function moveToken(input: {
    destinationListId: string;
    destinationListRevision: number;
    destinationProjectId: string | null;
    destinationProjectRevision: number | null;
    detachedProjectId: string | null;
    sourceListId: string;
    sourceListRevision: number;
    sourceProjectId: string | null;
    sourceProjectRevision: number | null;
    taskId: string;
    taskRevision: number;
  }): string {
    return createHash("sha256").update(JSON.stringify(input)).digest("hex");
  }

  async function findTask(userId: string, id: string, deleted: boolean): Promise<TaskRow> {
    const row = (
      await db
        .select()
        .from(reminders)
        .where(
          and(
            eq(reminders.id, id),
            eq(reminders.userId, userId),
            eq(reminders.kind, "task"),
            deleted ? isNotNull(reminders.deletedAt) : isNull(reminders.deletedAt),
          ),
        )
        .limit(1)
    )[0];
    if (!row) {
      throw new AppError(
        "not_found",
        deleted ? "The trashed Task was not found." : "The Task was not found.",
      );
    }
    assertCanonicalTask(row);
    return row;
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
    if (ids.length === 0) return [];
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

  async function lockTask(
    transaction: DbTransaction,
    userId: string,
    id: string,
    deleted: boolean,
  ): Promise<TaskRow> {
    const row = (
      await transaction
        .select()
        .from(reminders)
        .where(
          and(
            eq(reminders.id, id),
            eq(reminders.userId, userId),
            eq(reminders.kind, "task"),
            deleted ? isNotNull(reminders.deletedAt) : isNull(reminders.deletedAt),
          ),
        )
        .for("update")
    )[0];
    if (!row) {
      throw new AppError(
        "not_found",
        deleted ? "The trashed Task was not found." : "The Task was not found.",
      );
    }
    assertCanonicalTask(row);
    return row;
  }

  async function lockHierarchy(
    transaction: DbTransaction,
    observed: TaskRow,
    options: {
      deleted: boolean;
      destinationListId?: string;
      destinationProjectId?: string | null;
    },
  ): Promise<LockedTaskHierarchy> {
    assertCanonicalTask(observed);
    const lists = await lockLists(transaction, observed.userId, [
      observed.taskListId,
      ...(options.destinationListId ? [options.destinationListId] : []),
    ]);
    const projects = await lockProjects(
      transaction,
      observed.userId,
      [observed.taskProjectId, options.destinationProjectId].filter(
        (value): value is string => typeof value === "string",
      ),
    );
    const task = await lockTask(transaction, observed.userId, observed.id, options.deleted);
    if (
      task.taskRevision !== observed.taskRevision ||
      task.taskListId !== observed.taskListId ||
      task.taskProjectId !== observed.taskProjectId ||
      task.taskLifecycle !== observed.taskLifecycle ||
      task.deletedAt?.toISOString() !== observed.deletedAt?.toISOString()
    ) {
      throw revisionConflict(task.taskRevision);
    }
    const sourceList = lists.find((list) => list.id === task.taskListId);
    if (!sourceList) throw new AppError("not_found", "The source task List was not found.");
    const sourceProject = task.taskProjectId
      ? (projects.find((project) => project.id === task.taskProjectId) ?? null)
      : null;
    if (task.taskProjectId && !sourceProject) {
      throw new AppError("not_found", "The source task Project was not found.");
    }
    return {
      destinationList: options.destinationListId
        ? (lists.find((list) => list.id === options.destinationListId) ?? null)
        : null,
      destinationProject:
        typeof options.destinationProjectId === "string"
          ? (projects.find((project) => project.id === options.destinationProjectId) ?? null)
          : null,
      sourceList,
      sourceProject,
      task,
    };
  }

  function assertActiveDestinationList(list: ListRow | null, restoring = false): ListRow {
    if (list?.availability !== "active") {
      throw new AppError(
        restoring ? "conflict" : "not_found",
        "The destination task List is unavailable.",
        { code: "task_destination_unavailable" },
      );
    }
    return list;
  }

  function assertActiveDestinationProject(
    project: ProjectRow | null,
    destinationListId: string,
    restoring = false,
  ): ProjectRow {
    if (
      !project ||
      project.listId !== destinationListId ||
      project.availability !== "active" ||
      project.lifecycle !== "open"
    ) {
      throw new AppError(
        restoring ? "conflict" : "not_found",
        "The destination task Project is unavailable.",
        { code: "task_destination_unavailable" },
      );
    }
    return project;
  }

  async function replayOrConflict(
    userId: string,
    idempotencyKey: string | undefined,
    fingerprint: string,
  ): Promise<Task> {
    if (idempotencyKey) {
      const replay = (
        await db
          .select()
          .from(reminders)
          .where(
            and(
              eq(reminders.userId, userId),
              eq(reminders.kind, "task"),
              eq(reminders.taskCreateIdempotencyKey, idempotencyKey),
            ),
          )
          .limit(1)
      )[0];
      if (replay) {
        if (replay.taskCreateIdempotencyFingerprint === fingerprint) {
          return serializeTask(replay);
        }
        throw new AppError("conflict", "That idempotency key was used for another Task.", {
          code: "task_idempotency_mismatch",
        });
      }
    }
    throw new AppError("conflict", "The Task could not be created because it conflicts.");
  }

  async function resolveExistingReplay(
    input: CreateTaskInput,
    userId: string,
  ): Promise<Task | null> {
    if (!input.idempotencyKey) return null;
    const replay = (
      await db
        .select()
        .from(reminders)
        .where(
          and(
            eq(reminders.userId, userId),
            eq(reminders.kind, "task"),
            eq(reminders.taskCreateIdempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1)
    )[0];
    if (!replay) return null;

    let originalListId = input.listId;
    if (!originalListId) {
      const creation = (
        await db
          .select({ after: auditEvents.after })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.userId, userId),
              eq(auditEvents.entityType, "task"),
              eq(auditEvents.entityId, replay.id),
              eq(auditEvents.action, "task.created"),
            ),
          )
          .limit(1)
      )[0];
      const after = creation?.after;
      if (
        typeof after !== "object" ||
        after === null ||
        !("listId" in after) ||
        typeof after.listId !== "string"
      ) {
        throw new AppError(
          "internal_error",
          "The original Task destination could not be reconstructed for idempotency replay.",
        );
      }
      originalListId = after.listId;
    }

    if (replay.taskCreateIdempotencyFingerprint !== createFingerprint(input, originalListId)) {
      throw new AppError("conflict", "That idempotency key was used for another Task.", {
        code: "task_idempotency_mismatch",
      });
    }
    return serializeTask(replay);
  }

  async function transition(
    id: string,
    input: CompleteTaskInput | CancelTaskInput | ReopenTaskInput,
    context: MutationContext,
    target: "completed" | "cancelled" | "open",
  ): Promise<Task> {
    requireAgentRevision(context, input.expectedRevision);
    const observed = await findTask(context.principal.userId, id, false);
    assertExpectedRevision(observed, input.expectedRevision);
    const row = await db.transaction(async (transaction) => {
      const { task: before } = await lockHierarchy(transaction, observed, { deleted: false });
      assertExpectedRevision(before, input.expectedRevision);
      if (target === "open" ? before.taskLifecycle === "open" : before.taskLifecycle !== "open") {
        throw new AppError(
          "conflict",
          target === "open"
            ? "Only a completed or cancelled Task can be reopened."
            : `Only an open Task can be ${target}.`,
          { code: "task_lifecycle_conflict", currentRevision: before.taskRevision },
        );
      }
      const changedAt = now();
      const after = requireDatabaseRecord(
        (
          await transaction
            .update(reminders)
            .set({
              completedAt: target === "completed" ? changedAt : null,
              status: projectedLegacyStatus(target, before.scheduledAt),
              taskCancelledAt: target === "cancelled" ? changedAt : null,
              taskLifecycle: target,
              taskRevision: (before.taskRevision as number) + 1,
              updatedAt: changedAt,
            })
            .where(
              and(
                eq(reminders.id, before.id),
                eq(reminders.userId, before.userId),
                eq(reminders.kind, "task"),
                eq(reminders.taskRevision, before.taskRevision as number),
                isNull(reminders.deletedAt),
              ),
            )
            .returning()
        )[0],
        "The Task transition could not be applied.",
      );
      await transaction.insert(auditEvents).values(
        auditValues({
          action: target === "open" ? "task.reopened" : `task.${target}`,
          after: taskAuditState(after),
          before: taskAuditState(before),
          entityId: after.id,
          entityType: "task",
          ...context,
        }),
      );
      return after;
    });
    return serializeTask(row);
  }

  return {
    async cancel(id: string, input: CancelTaskInput, context: MutationContext): Promise<Task> {
      return transition(id, input, context, "cancelled");
    },

    async complete(id: string, input: CompleteTaskInput, context: MutationContext): Promise<Task> {
      return transition(id, input, context, "completed");
    },

    async create(input: CreateTaskInput, context: MutationContext): Promise<Task> {
      if (context.principal.actorType === "agent" && !input.idempotencyKey) {
        throw new AppError("invalid_request", "Agent Task creates require an idempotency key.");
      }
      const existingReplay = await resolveExistingReplay(input, context.principal.userId);
      if (existingReplay) return existingReplay;
      const observedProject = input.projectId
        ? (
            await db
              .select({ listId: taskProjects.listId })
              .from(taskProjects)
              .where(
                and(
                  eq(taskProjects.id, input.projectId),
                  eq(taskProjects.userId, context.principal.userId),
                  isNull(taskProjects.deletedAt),
                ),
              )
              .limit(1)
          )[0]
        : undefined;
      if (input.projectId && !observedProject) {
        throw new AppError("not_found", "The destination task Project was not found.");
      }
      const observedListId =
        input.listId ??
        observedProject?.listId ??
        (
          await db
            .select({ id: taskLists.id })
            .from(taskLists)
            .where(
              and(
                eq(taskLists.userId, context.principal.userId),
                eq(taskLists.kind, "inbox"),
                isNull(taskLists.deletedAt),
              ),
            )
            .limit(1)
        )[0]?.id;
      if (!observedListId)
        throw new AppError("not_found", "The destination task List was not found.");
      const fingerprint = createFingerprint(input, observedListId);
      try {
        const row = await db.transaction(async (transaction) => {
          const destination = assertActiveDestinationList(
            (await lockLists(transaction, context.principal.userId, [observedListId]))[0] ?? null,
          );
          const project = input.projectId
            ? assertActiveDestinationProject(
                (await lockProjects(transaction, context.principal.userId, [input.projectId]))[0] ??
                  null,
                destination.id,
              )
            : null;
          const changedAt = now();
          const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : null;
          const created = requireDatabaseRecord(
            (
              await transaction
                .insert(reminders)
                .values({
                  completedAt: input.lifecycle === "completed" ? changedAt : null,
                  dueAt: input.dueAt ? new Date(input.dueAt) : null,
                  estimateMinutes: input.estimateMinutes,
                  kind: "task",
                  notes: input.notes,
                  priority: input.priority,
                  scheduledAt,
                  status: projectedLegacyStatus(input.lifecycle, scheduledAt),
                  tags: input.tags,
                  taskCancelledAt: input.lifecycle === "cancelled" ? changedAt : null,
                  taskCreateIdempotencyFingerprint: input.idempotencyKey ? fingerprint : null,
                  taskCreateIdempotencyKey: input.idempotencyKey ?? null,
                  taskLifecycle: input.lifecycle,
                  taskListId: destination.id,
                  taskProjectId: project?.id ?? null,
                  taskRevision: 1,
                  taskWhy: input.why,
                  timezone: input.timezone,
                  title: input.title,
                  userId: context.principal.userId,
                })
                .returning()
            )[0],
            "The Task could not be created.",
          );
          await transaction.insert(auditEvents).values(
            auditValues({
              action: "task.created",
              after: taskAuditState(created),
              before: null,
              entityId: created.id,
              entityType: "task",
              ...context,
            }),
          );
          return created;
        });
        return serializeTask(row);
      } catch (error) {
        if (isUniqueViolation(error, "reminders_task_create_idempotency_idx")) {
          return replayOrConflict(context.principal.userId, input.idempotencyKey, fingerprint);
        }
        throw error;
      }
    },

    async get(id: string, userId: string): Promise<Task> {
      return serializeTask(await findTask(userId, id, false));
    },

    async list(
      userId: string,
      query: TaskListQuery,
    ): Promise<{ items: Task[]; nextCursor: string | null }> {
      const conditions = [eq(reminders.userId, userId), eq(reminders.kind, "task")];
      conditions.push(
        query.view === "trash" ? isNotNull(reminders.deletedAt) : isNull(reminders.deletedAt),
      );
      if (query.view !== "trash" && query.listId === undefined) {
        conditions.push(
          inArray(
            reminders.taskListId,
            db
              .select({ id: taskLists.id })
              .from(taskLists)
              .where(
                and(
                  eq(taskLists.userId, userId),
                  eq(taskLists.availability, "active"),
                  isNull(taskLists.deletedAt),
                ),
              ),
          ),
        );
      }
      if (query.lifecycle) conditions.push(eq(reminders.taskLifecycle, query.lifecycle));
      if (query.listId) conditions.push(eq(reminders.taskListId, query.listId));
      if (query.projectId) conditions.push(eq(reminders.taskProjectId, query.projectId));
      if (query.dueAfter) conditions.push(gte(reminders.dueAt, new Date(query.dueAfter)));
      if (query.dueBefore) conditions.push(lte(reminders.dueAt, new Date(query.dueBefore)));
      if (query.scheduledAfter) {
        conditions.push(gte(reminders.scheduledAt, new Date(query.scheduledAfter)));
      }
      if (query.scheduledBefore) {
        conditions.push(lte(reminders.scheduledAt, new Date(query.scheduledBefore)));
      }
      if (query.query) {
        const search = or(
          ilike(reminders.title, `%${query.query}%`),
          ilike(reminders.notes, `%${query.query}%`),
          ilike(reminders.taskWhy, `%${query.query}%`),
        );
        if (search) conditions.push(search);
      }
      if (query.view === "scheduled") {
        conditions.push(eq(reminders.taskLifecycle, "open"), isNotNull(reminders.scheduledAt));
      } else if (query.view === "completed") {
        conditions.push(eq(reminders.taskLifecycle, "completed"));
      } else if (query.view === "cancelled") {
        conditions.push(eq(reminders.taskLifecycle, "cancelled"));
      } else if (query.view === "today" || query.view === "upcoming") {
        const user = (
          await db
            .select({ planningTimezone: users.planningTimezone })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1)
        )[0];
        if (!user) throw new AppError("not_found", "The Task owner was not found.");
        const range = localDayRange(now(), user.planningTimezone);
        const from = query.view === "today" ? new Date(range.from) : new Date(range.to);
        const timing =
          query.view === "today"
            ? or(
                and(gte(reminders.dueAt, from), lt(reminders.dueAt, new Date(range.to))),
                and(
                  gte(reminders.scheduledAt, from),
                  lt(reminders.scheduledAt, new Date(range.to)),
                ),
              )
            : or(gte(reminders.dueAt, from), gte(reminders.scheduledAt, from));
        conditions.push(eq(reminders.taskLifecycle, "open"));
        if (timing) conditions.push(timing);
      }
      if (query.cursor) {
        const cursor = decodeCursor(query.cursor);
        const cursorCondition = or(
          lt(reminders.createdAt, cursor.createdAt),
          and(eq(reminders.createdAt, cursor.createdAt), lt(reminders.id, cursor.id)),
        );
        if (cursorCondition) conditions.push(cursorCondition);
      }
      const rows = await db
        .select()
        .from(reminders)
        .where(and(...conditions))
        .orderBy(desc(reminders.createdAt), desc(reminders.id))
        .limit(query.limit + 1);
      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;
      const last = page.at(-1);
      return {
        items: page.map(serializeTask),
        nextCursor:
          hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
      };
    },

    async move(id: string, input: MoveTaskInput, context: MutationContext): Promise<Task> {
      requireAgentRevision(context, input.expectedRevision);
      const observed = await findTask(context.principal.userId, id, false);
      assertExpectedRevision(observed, input.expectedRevision);
      const row = await db.transaction(async (transaction) => {
        const locked = await lockHierarchy(transaction, observed, {
          deleted: false,
          destinationListId: input.destinationListId,
          destinationProjectId: input.destinationProjectId ?? null,
        });
        assertExpectedRevision(locked.task, input.expectedRevision);
        const destinationList = assertActiveDestinationList(locked.destinationList);
        const destinationProject = input.destinationProjectId
          ? assertActiveDestinationProject(locked.destinationProject, destinationList.id)
          : null;
        const detachedProjectId =
          locked.sourceProject && locked.sourceProject.id !== destinationProject?.id
            ? locked.sourceProject.id
            : null;
        const tokenValues = {
          destinationListId: destinationList.id,
          destinationListRevision: destinationList.revision,
          destinationProjectId: destinationProject?.id ?? null,
          destinationProjectRevision: destinationProject?.revision ?? null,
          detachedProjectId,
          sourceListId: locked.sourceList.id,
          sourceListRevision: locked.sourceList.revision,
          sourceProjectId: locked.sourceProject?.id ?? null,
          sourceProjectRevision: locked.sourceProject?.revision ?? null,
          taskId: locked.task.id,
          taskRevision: locked.task.taskRevision as number,
        };
        if (moveToken(tokenValues) !== input.previewToken) {
          throw new AppError("conflict", "The Task move preview is stale.", {
            code: "task_move_preview_stale",
            currentRevision: locked.task.taskRevision,
          });
        }
        if (
          locked.task.taskListId === destinationList.id &&
          locked.task.taskProjectId === (destinationProject?.id ?? null)
        ) {
          throw new AppError("conflict", "The Task is already in that destination.", {
            code: "task_destination_unavailable",
          });
        }
        const changedAt = now();
        const after = requireDatabaseRecord(
          (
            await transaction
              .update(reminders)
              .set({
                taskListId: destinationList.id,
                taskProjectId: destinationProject?.id ?? null,
                taskRevision: (locked.task.taskRevision as number) + 1,
                updatedAt: changedAt,
              })
              .where(
                and(
                  eq(reminders.id, locked.task.id),
                  eq(reminders.userId, locked.task.userId),
                  eq(reminders.kind, "task"),
                  eq(reminders.taskRevision, locked.task.taskRevision as number),
                  isNull(reminders.deletedAt),
                ),
              )
              .returning()
          )[0],
          "The Task could not be moved.",
        );
        await transaction.insert(auditEvents).values(
          auditValues({
            action: "task.moved",
            after: taskAuditState(after),
            before: taskAuditState(locked.task),
            entityId: after.id,
            entityType: "task",
            ...context,
          }),
        );
        return after;
      });
      return serializeTask(row);
    },

    async previewMove(
      id: string,
      input: TaskMovePreviewInput,
      context: MutationContext,
    ): Promise<TaskMovePreview> {
      requireAgentRevision(context, input.expectedRevision);
      const observed = await findTask(context.principal.userId, id, false);
      assertExpectedRevision(observed, input.expectedRevision);
      return db.transaction(async (transaction) => {
        const locked = await lockHierarchy(transaction, observed, {
          deleted: false,
          destinationListId: input.destinationListId,
          destinationProjectId: input.destinationProjectId ?? null,
        });
        assertExpectedRevision(locked.task, input.expectedRevision);
        const destinationList = assertActiveDestinationList(locked.destinationList);
        const destinationProject = input.destinationProjectId
          ? assertActiveDestinationProject(locked.destinationProject, destinationList.id)
          : null;
        const detachedProjectId =
          locked.sourceProject && locked.sourceProject.id !== destinationProject?.id
            ? locked.sourceProject.id
            : null;
        const tokenValues = {
          destinationListId: destinationList.id,
          destinationListRevision: destinationList.revision,
          destinationProjectId: destinationProject?.id ?? null,
          destinationProjectRevision: destinationProject?.revision ?? null,
          detachedProjectId,
          sourceListId: locked.sourceList.id,
          sourceListRevision: locked.sourceList.revision,
          sourceProjectId: locked.sourceProject?.id ?? null,
          sourceProjectRevision: locked.sourceProject?.revision ?? null,
          taskId: locked.task.id,
          taskRevision: locked.task.taskRevision as number,
        };
        const { sourceProjectRevision: _, ...preview } = tokenValues;
        return { ...preview, previewToken: moveToken(tokenValues) } as TaskMovePreview;
      });
    },

    async reopen(id: string, input: ReopenTaskInput, context: MutationContext): Promise<Task> {
      return transition(id, input, context, "open");
    },

    async restore(id: string, input: RestoreTaskInput, context: MutationContext): Promise<Task> {
      requireAgentRevision(context, input.expectedRevision);
      const observed = await findTask(context.principal.userId, id, true);
      assertExpectedRevision(observed, input.expectedRevision);
      const row = await db.transaction(async (transaction) => {
        const locked = await lockHierarchy(transaction, observed, { deleted: true });
        assertExpectedRevision(locked.task, input.expectedRevision);
        assertActiveDestinationList(locked.sourceList, true);
        if (locked.task.taskProjectId) {
          assertActiveDestinationProject(locked.sourceProject, locked.sourceList.id, true);
        }
        const changedAt = now();
        const after = requireDatabaseRecord(
          (
            await transaction
              .update(reminders)
              .set({
                deletedAt: null,
                taskRevision: (locked.task.taskRevision as number) + 1,
                updatedAt: changedAt,
              })
              .where(
                and(
                  eq(reminders.id, locked.task.id),
                  eq(reminders.userId, locked.task.userId),
                  eq(reminders.kind, "task"),
                  eq(reminders.taskRevision, locked.task.taskRevision as number),
                  isNotNull(reminders.deletedAt),
                ),
              )
              .returning()
          )[0],
          "The Task could not be restored.",
        );
        await transaction.insert(auditEvents).values(
          auditValues({
            action: "task.restored",
            after: taskAuditState(after),
            before: taskAuditState(locked.task),
            entityId: after.id,
            entityType: "task",
            ...context,
          }),
        );
        return after;
      });
      return serializeTask(row);
    },

    async trash(id: string, input: TrashTaskInput, context: MutationContext): Promise<Task> {
      requireAgentRevision(context, input.expectedRevision);
      const observed = await findTask(context.principal.userId, id, false);
      assertExpectedRevision(observed, input.expectedRevision);
      const row = await db.transaction(async (transaction) => {
        const { task: before } = await lockHierarchy(transaction, observed, { deleted: false });
        assertExpectedRevision(before, input.expectedRevision);
        const changedAt = now();
        const after = requireDatabaseRecord(
          (
            await transaction
              .update(reminders)
              .set({
                deletedAt: changedAt,
                taskRevision: (before.taskRevision as number) + 1,
                updatedAt: changedAt,
              })
              .where(
                and(
                  eq(reminders.id, before.id),
                  eq(reminders.userId, before.userId),
                  eq(reminders.kind, "task"),
                  eq(reminders.taskRevision, before.taskRevision as number),
                  isNull(reminders.deletedAt),
                ),
              )
              .returning()
          )[0],
          "The Task could not be trashed.",
        );
        await transaction.insert(auditEvents).values(
          auditValues({
            action: "task.trashed",
            after: taskAuditState(after),
            before: taskAuditState(before),
            entityId: after.id,
            entityType: "task",
            ...context,
          }),
        );
        return after;
      });
      return serializeTask(row);
    },

    async update(id: string, input: UpdateTaskInput, context: MutationContext): Promise<Task> {
      requireAgentRevision(context, input.expectedRevision);
      const observed = await findTask(context.principal.userId, id, false);
      assertExpectedRevision(observed, input.expectedRevision);
      const row = await db.transaction(async (transaction) => {
        const { task: before } = await lockHierarchy(transaction, observed, { deleted: false });
        assertExpectedRevision(before, input.expectedRevision);
        const changedAt = now();
        const scheduledAt =
          input.scheduledAt === undefined
            ? before.scheduledAt
            : input.scheduledAt
              ? new Date(input.scheduledAt)
              : null;
        const timingChanged =
          input.dueAt !== undefined ||
          input.scheduledAt !== undefined ||
          input.timezone !== undefined;
        const after = requireDatabaseRecord(
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
                ...(input.scheduledAt === undefined ? {} : { scheduledAt }),
                ...(input.tags === undefined ? {} : { tags: input.tags }),
                ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
                ...(input.title === undefined ? {} : { title: input.title }),
                ...(input.why === undefined ? {} : { taskWhy: input.why }),
                ...(timingChanged
                  ? {
                      status: projectedLegacyStatus(
                        before.taskLifecycle as NonNullable<TaskRow["taskLifecycle"]>,
                        scheduledAt,
                      ),
                    }
                  : {}),
                taskRevision: (before.taskRevision as number) + 1,
                updatedAt: changedAt,
              })
              .where(
                and(
                  eq(reminders.id, before.id),
                  eq(reminders.userId, before.userId),
                  eq(reminders.kind, "task"),
                  eq(reminders.taskRevision, before.taskRevision as number),
                  isNull(reminders.deletedAt),
                ),
              )
              .returning()
          )[0],
          "The Task could not be updated.",
        );
        await transaction.insert(auditEvents).values(
          auditValues({
            action: "task.updated",
            after: taskAuditState(after),
            before: taskAuditState(before),
            entityId: after.id,
            entityType: "task",
            ...context,
          }),
        );
        return after;
      });
      return serializeTask(row);
    },
  };
}
