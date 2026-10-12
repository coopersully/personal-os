import { createHmac, timingSafeEqual } from "node:crypto";
import { calendarWorkspaceSettings, type Database, reminders, users } from "@personal-os/database";
import {
  localDayRange,
  type TodayCommitmentGroup,
  type TodayCommitmentPage,
  type TodayCommitmentQuery,
  todayWeekRange,
} from "@personal-os/domain";
import { and, asc, eq, isNull, lt, or, type SQL, sql } from "drizzle-orm";
import { AppError } from "../errors.js";
import { serializeReminder, serializeTask } from "../serialization.js";
import type { Principal } from "../types.js";

export function createTodayCommitmentsService(db: Database, now: () => Date, signingKey: string) {
  const sign = (value: string) =>
    createHmac("sha256", signingKey).update(value).digest("base64url");
  return {
    async list(principal: Principal, query: TodayCommitmentQuery): Promise<TodayCommitmentPage> {
      const current = now();
      const [user] = await db
        .select({ timeZone: users.planningTimezone })
        .from(users)
        .where(eq(users.id, principal.userId));
      if (!user) throw new AppError("not_found", "Account not found.");
      const [calendar] = await db
        .select({ weekStartsOn: calendarWorkspaceSettings.weekStartsOn })
        .from(calendarWorkspaceSettings)
        .where(eq(calendarWorkspaceSettings.userId, principal.userId));
      const range = todayWeekRange(
        current,
        user.timeZone,
        calendar?.weekStartsOn === "monday" ? "monday" : "sunday",
      );
      const day = localDayRange(current, user.timeZone);
      const canTasks = principal.scopes.has("tasks:read");
      const canReminders = principal.scopes.has("reminders:read");
      const unavailableSources: TodayCommitmentPage["unavailableSources"] = [
        ...(canTasks ? [] : ["tasks" as const]),
        ...(canReminders ? [] : ["reminders" as const]),
      ];
      const binding = JSON.stringify([
        principal.userId,
        range.weekStart,
        user.timeZone,
        day.from,
        query.filter,
        query.includeUndated,
        canTasks,
        canReminders,
      ]);
      let offset = 0;
      let cutoff = current.toISOString();
      if (query.cursor) {
        try {
          const [payload, signature, extra] = query.cursor.split(".");
          if (
            extra !== undefined ||
            !payload ||
            !signature ||
            signature.length !== sign(payload).length ||
            !timingSafeEqual(Buffer.from(signature), Buffer.from(sign(payload)))
          )
            throw new Error();
          const parsed = JSON.parse(Buffer.from(payload, "base64url").toString());
          if (
            parsed.binding !== binding ||
            !Number.isSafeInteger(parsed.offset) ||
            parsed.offset < 0 ||
            parsed.offset > 1000000 ||
            !Number.isFinite(Date.parse(parsed.cutoff)) ||
            Date.parse(parsed.cutoff) > current.getTime() ||
            current.getTime() - Date.parse(parsed.cutoff) > 15 * 60000
          )
            throw new Error();
          offset = parsed.offset;
          cutoff = parsed.cutoff;
        } catch {
          throw new AppError("invalid_request", "This week or filter changed. Reload the list.");
        }
      }
      const resultBase = {
        generatedAt: current.toISOString(),
        timeZone: user.timeZone,
        weekStart: range.weekStart,
        weekEndExclusive: range.weekEndExclusive,
        unavailableSources,
      };
      if (!canTasks && !canReminders)
        return {
          ...resultBase,
          items: [],
          nextCursor: null,
          counts: { all: null, overdue: null, tasks: null, reminders: null },
        };
      const task = and(eq(reminders.kind, "task"), eq(reminders.taskLifecycle, "open"));
      const reminder = eq(reminders.kind, "reminder");
      const authorized = or(...[...(canTasks ? [task] : []), ...(canReminders ? [reminder] : [])]);
      const scheduled = sql`CASE WHEN ${reminders.kind} = 'task' AND ${reminders.scheduledAt} >= ${range.from}::timestamptz AND ${reminders.scheduledAt} < ${range.to}::timestamptz THEN ${reminders.scheduledAt} END`;
      const effective = sql`LEAST(${reminders.dueAt}, ${scheduled})`;
      const relevance = or(
        lt(reminders.dueAt, new Date(range.to)),
        sql`${scheduled} IS NOT NULL`,
        ...(query.includeUndated
          ? [and(isNull(reminders.dueAt), isNull(reminders.scheduledAt))]
          : []),
      );
      const base = and(
        eq(reminders.userId, principal.userId),
        isNull(reminders.completedAt),
        isNull(reminders.deletedAt),
        authorized,
        relevance,
      );
      const overdue = sql`${reminders.dueAt} < ${cutoff}::timestamptz`;
      const group = sql<number>`CASE WHEN ${overdue} THEN 0 WHEN ${effective} < ${day.to}::timestamptz THEN 1 WHEN ${effective} IS NOT NULL THEN 2 ELSE 3 END`;
      let filter: SQL | undefined;
      if (query.filter === "overdue") filter = overdue;
      if (query.filter === "tasks") filter = eq(reminders.kind, "task");
      if (query.filter === "reminders") filter = eq(reminders.kind, "reminder");
      const limit = Math.min(100, Math.max(1, query.limit ?? 6));
      return db.transaction(async (tx) => {
        await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
        await tx.execute(sql`SET LOCAL statement_timeout = '2000ms'`);
        const [counts] = await tx
          .select({
            all: sql<number>`count(*)::int`,
            overdue: sql<number>`count(*) FILTER (WHERE ${overdue})::int`,
            tasks: sql<number>`count(*) FILTER (WHERE ${reminders.kind} = 'task')::int`,
            reminders: sql<number>`count(*) FILTER (WHERE ${reminders.kind} = 'reminder')::int`,
          })
          .from(reminders)
          .where(base);
        const rows = await tx
          .select({ row: reminders, group })
          .from(reminders)
          .where(and(base, filter))
          .orderBy(group, asc(effective), asc(reminders.id))
          .limit(limit + 1)
          .offset(offset);
        const more = rows.length > limit;
        const payload = Buffer.from(
          JSON.stringify({ binding, cutoff, offset: offset + limit }),
        ).toString("base64url");
        const groups: TodayCommitmentGroup[] = ["overdue", "today", "later_this_week", "undated"];
        return {
          ...resultBase,
          nextCursor: more ? `${payload}.${sign(payload)}` : null,
          counts: {
            all: unavailableSources.length ? null : (counts?.all ?? 0),
            overdue: unavailableSources.length ? null : (counts?.overdue ?? 0),
            tasks: canTasks ? (counts?.tasks ?? 0) : null,
            reminders: canReminders ? (counts?.reminders ?? 0) : null,
          },
          items: rows.slice(0, limit).map(({ row, group }) =>
            row.kind === "task"
              ? { kind: "task" as const, group: groups[group]!, material: serializeTask(row) }
              : {
                  kind: "reminder" as const,
                  group: groups[group]!,
                  material: serializeReminder(row),
                },
          ),
        };
      });
    },
  };
}
