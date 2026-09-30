import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { type Database, reminders, taskLists, taskProjects, users } from "@personal-os/database";
import {
  idSchema,
  localDayRange,
  type TaskWorkspacePage,
  type TaskWorkspaceQuery,
  taskWorkspaceQuerySchema,
} from "@personal-os/domain";
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  gt,
  gte,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { AppError } from "./errors.js";
import { serializeReminder, serializeTask } from "./serialization.js";

const cursorSchema = z.object({
  version: z.literal(2),
  fingerprint: z.string().length(64),
  asOf: z.iso.datetime(),
  group: z.string(),
  rank: z.number().int().min(0).max(2),
  missing: z.number().int().min(0).max(1),
  value: z.string(),
  id: idSchema,
});
type Cursor = z.infer<typeof cursorSchema>;

/** SQL owns membership, total, grouping and keyset order across both physical row kinds. */
export function createTaskWorkspaceService({
  db,
  now,
  cursorSecret,
}: {
  db: Database;
  now: () => Date;
  cursorSecret: string;
}) {
  const signature = (payload: string) =>
    createHmac("sha256", cursorSecret).update(`task-workspace:${payload}`).digest("hex");
  function encodeCursor(cursor: Cursor): string {
    const payload = Buffer.from(JSON.stringify(cursor)).toString("base64url");
    return `${payload}.${signature(payload)}`;
  }
  function decodeCursor(encoded: string): Cursor {
    try {
      const parts = encoded.split(".");
      const [payload, signed] = parts;
      if (parts.length !== 2 || !payload || !signed) throw new Error("Invalid envelope");
      const received = Buffer.from(signed);
      const expected = Buffer.from(signature(payload));
      if (received.length !== expected.length || !timingSafeEqual(received, expected))
        throw new Error("Invalid signature");
      return cursorSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    } catch {
      throw new AppError("invalid_request", "The task workspace pagination cursor is invalid.");
    }
  }

  return {
    async list(userId: string, input: TaskWorkspaceQuery): Promise<TaskWorkspacePage> {
      const query = taskWorkspaceQuerySchema.parse(input);
      const cursor = query.cursor ? decodeCursor(query.cursor) : null;
      const asOf = cursor?.asOf ?? now().toISOString();
      const status =
        query.status ?? (query.view === "history" || query.view === "trash" ? "all" : "open");
      // A consistent database snapshot keeps total and rows in agreement for this page.
      // Cursors freeze the clock, not the records: later edits remain visible on later requests.
      return db.transaction(
        async (transaction) => {
          const [user] = await transaction
            .select({ timezone: users.planningTimezone })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);
          if (!user) throw new AppError("not_found", "The task workspace owner was not found.");
          const { cursor: _cursor, limit: _limit, ...filters } = query;
          const fingerprint = createHash("sha256")
            .update(JSON.stringify({ userId, timezone: user.timezone, ...filters, status }))
            .digest("hex");
          if (cursor && cursor.fingerprint !== fingerprint)
            throw new AppError(
              "invalid_request",
              "The task workspace pagination cursor does not match this query.",
            );
          const day = localDayRange(new Date(asOf), user.timezone);
          const scheduled = sql<Date | null>`CASE WHEN ${reminders.kind} = 'task' THEN ${reminders.scheduledAt} END`;
          const lifecycle = sql<string>`CASE WHEN ${reminders.kind} = 'task' THEN ${reminders.taskLifecycle} WHEN ${reminders.completedAt} IS NULL THEN 'open' ELSE 'completed' END`;
          const unavailable = sql<boolean>`(${reminders.kind} = 'task' AND (
          ${taskLists.id} IS NULL OR ${taskLists.availability} <> 'active' OR ${taskLists.deletedAt} IS NOT NULL
          OR (${reminders.taskProjectId} IS NOT NULL AND (
            ${taskProjects.id} IS NULL OR ${taskProjects.availability} <> 'active'
            OR ${taskProjects.lifecycle} <> 'open' OR ${taskProjects.deletedAt} IS NOT NULL))))`;
          const conditions: SQL[] = [
            eq(reminders.userId, userId),
            query.view === "trash" ? isNotNull(reminders.deletedAt) : isNull(reminders.deletedAt),
          ];
          if (query.kind !== "all") conditions.push(eq(reminders.kind, query.kind));
          if (query.listId) conditions.push(eq(reminders.taskListId, query.listId));
          if (query.projectId) conditions.push(eq(reminders.taskProjectId, query.projectId));
          if (query.view === "history")
            conditions.push(sql`(${lifecycle} <> 'open' OR ${unavailable})`);
          else if (
            query.view !== "trash" &&
            status !== "archived" &&
            !query.listId &&
            !query.projectId
          )
            conditions.push(sql`NOT ${unavailable}`);
          if (status === "archived") conditions.push(unavailable);
          else if (status !== "all") conditions.push(eq(lifecycle, status));

          let relevantAt: SQL<Date | null> = sql`LEAST(${reminders.dueAt}, ${scheduled})`;
          if (query.view === "today") {
            conditions.push(
              sql`(${reminders.dueAt} < ${day.to}::timestamptz OR (${scheduled} >= ${day.from}::timestamptz AND ${scheduled} < ${day.to}::timestamptz))`,
            );
            relevantAt = sql`CASE WHEN ${reminders.dueAt} < ${day.from}::timestamptz THEN ${reminders.dueAt}
            WHEN ${scheduled} >= ${day.from}::timestamptz AND ${scheduled} < ${day.to}::timestamptz THEN ${scheduled} ELSE ${reminders.dueAt} END`;
          } else if (query.view === "upcoming") {
            conditions.push(
              sql`(${reminders.dueAt} >= ${day.to}::timestamptz OR ${scheduled} >= ${day.to}::timestamptz)`,
            );
            relevantAt = sql`LEAST(CASE WHEN ${reminders.dueAt} >= ${day.to}::timestamptz THEN ${reminders.dueAt} END,
            CASE WHEN ${scheduled} >= ${day.to}::timestamptz THEN ${scheduled} END)`;
          } else if (query.view === "trash") relevantAt = sql`${reminders.deletedAt}`;
          else if (query.view === "history")
            relevantAt = sql`COALESCE(${reminders.completedAt}, ${reminders.taskCancelledAt},
          ${taskLists.archivedAt}, ${taskProjects.archivedAt}, ${taskProjects.completedAt}, ${taskProjects.cancelledAt}, ${reminders.updatedAt})`;

          if (query.due === "none") conditions.push(isNull(reminders.dueAt));
          if (query.due === "dated") conditions.push(isNotNull(reminders.dueAt));
          if (query.due === "overdue")
            conditions.push(lt(reminders.dueAt, new Date(asOf)), eq(lifecycle, "open"));
          if (query.reserved === "none") conditions.push(isNull(scheduled));
          if (query.reserved === "scheduled") conditions.push(isNotNull(scheduled));
          if (query.dueAfter) conditions.push(gte(reminders.dueAt, new Date(query.dueAfter)));
          if (query.dueBefore) conditions.push(lte(reminders.dueAt, new Date(query.dueBefore)));
          if (query.scheduledAfter)
            conditions.push(sql`${scheduled} >= ${query.scheduledAfter}::timestamptz`);
          if (query.scheduledBefore)
            conditions.push(sql`${scheduled} <= ${query.scheduledBefore}::timestamptz`);
          if (query.priority) conditions.push(eq(reminders.priority, query.priority));
          if (query.tag)
            conditions.push(
              eq(reminders.kind, "task"),
              sql`${reminders.tags} @> ${JSON.stringify([query.tag])}::jsonb`,
            );
          if (query.query) {
            const pattern = `%${query.query.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
            conditions.push(sql`(${reminders.title} ILIKE ${pattern} ESCAPE '\\' OR ${reminders.notes} ILIKE ${pattern} ESCAPE '\\'
            OR (${reminders.kind} = 'task' AND ${reminders.taskWhy} ILIKE ${pattern} ESCAPE '\\'))`);
          }

          const group = sql<string>`(${
            query.group === "date"
              ? sql`COALESCE(to_char(${relevantAt} AT TIME ZONE ${user.timezone}, 'YYYY-MM-DD'), 'none')`
              : query.group === "list"
                ? sql`COALESCE(${reminders.taskListId}::text, 'none')`
                : query.group === "project"
                  ? sql`COALESCE(${reminders.taskProjectId}::text, 'none')`
                  : sql`'none'::text`
          }) COLLATE "C"`;
          const dateKey = (date: SQL<Date | null>) =>
            sql<string | null>`to_char(${date} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`;
          // Today defaults to overdue deadlines, reserved work, then due-only work.
          // Explicit sorts retain their requested order within the selected display groups.
          const rank =
            query.view === "today" && query.sort === "default"
              ? sql<number>`CASE WHEN ${reminders.dueAt} < ${day.from}::timestamptz THEN 0
                WHEN ${scheduled} >= ${day.from}::timestamptz AND ${scheduled} < ${day.to}::timestamptz THEN 1
                ELSE 2 END`
              : sql<number>`CAST(0 AS integer)`;
          const value =
            query.sort === "priority"
              ? sql<
                  string | null
                >`CASE ${reminders.priority} WHEN 'high' THEN '0' WHEN 'medium' THEN '1' ELSE '2' END`
              : query.sort === "title"
                ? sql<string | null>`lower(${reminders.title})`
                : query.sort === "estimate"
                  ? sql<
                      string | null
                    >`CASE WHEN ${reminders.kind} = 'task' THEN lpad(${reminders.estimateMinutes}::text, 4, '0') END`
                  : query.sort === "newest" || query.sort === "oldest"
                    ? dateKey(sql`${reminders.createdAt}`)
                    : query.sort === "reserved"
                      ? dateKey(scheduled)
                      : dateKey(relevantAt);
          const missing = sql<number>`CASE WHEN ${value} IS NULL THEN 1 ELSE 0 END`;
          const orderedValue = sql<string>`COALESCE(${value}, '') COLLATE "C"`;
          const id = sql<string>`${reminders.id}::text COLLATE "C"`;
          const descending =
            query.sort === "newest" ||
            (query.sort === "default" && (query.view === "history" || query.view === "trash"));
          const after = cursor
            ? or(
                gt(group, cursor.group),
                and(eq(group, cursor.group), gt(rank, cursor.rank)),
                and(eq(group, cursor.group), eq(rank, cursor.rank), gt(missing, cursor.missing)),
                and(
                  eq(group, cursor.group),
                  eq(rank, cursor.rank),
                  eq(missing, cursor.missing),
                  descending ? lt(orderedValue, cursor.value) : gt(orderedValue, cursor.value),
                ),
                and(
                  eq(group, cursor.group),
                  eq(rank, cursor.rank),
                  eq(missing, cursor.missing),
                  eq(orderedValue, cursor.value),
                  gt(id, cursor.id),
                ),
              )
            : undefined;
          const joined = () =>
            transaction
              .select({
                record: getTableColumns(reminders),
                group,
                rank,
                missing,
                value: orderedValue,
                // Restore owns Inbox fallback and project detachment for unavailable containers.
                readOnly: query.view === "trash" ? sql<boolean>`false` : unavailable,
                relevantAt: relevantAt.mapWith((value: string | Date) => new Date(value)),
              })
              .from(reminders)
              .leftJoin(
                taskLists,
                and(eq(taskLists.id, reminders.taskListId), eq(taskLists.userId, userId)),
              )
              .leftJoin(
                taskProjects,
                and(eq(taskProjects.id, reminders.taskProjectId), eq(taskProjects.userId, userId)),
              );
          const [totalRow] = await transaction
            .select({ total: count() })
            .from(reminders)
            .leftJoin(
              taskLists,
              and(eq(taskLists.id, reminders.taskListId), eq(taskLists.userId, userId)),
            )
            .leftJoin(
              taskProjects,
              and(eq(taskProjects.id, reminders.taskProjectId), eq(taskProjects.userId, userId)),
            )
            .where(and(...conditions));
          const rows = await joined()
            .where(and(...conditions, after))
            .orderBy(
              asc(group),
              asc(rank),
              asc(missing),
              descending ? desc(orderedValue) : asc(orderedValue),
              asc(id),
            )
            .limit(query.limit + 1);
          const page = rows.slice(0, query.limit);
          const last = page.at(-1);
          return {
            items: page.map((row) => ({
              ...(row.record.kind === "task"
                ? { kind: "task" as const, record: serializeTask(row.record) }
                : { kind: "reminder" as const, record: serializeReminder(row.record) }),
              deletedAt: row.record.deletedAt?.toISOString() ?? null,
              readOnly: row.readOnly,
              relevantAt: row.relevantAt?.toISOString() ?? null,
              groupKey: row.group,
            })),
            nextCursor:
              rows.length > query.limit && last
                ? encodeCursor({
                    version: 2,
                    fingerprint,
                    asOf,
                    group: last.group,
                    rank: last.rank,
                    missing: last.missing,
                    value: last.value,
                    id: last.record.id,
                  })
                : null,
            total: totalRow?.total ?? 0,
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },
  };
}
