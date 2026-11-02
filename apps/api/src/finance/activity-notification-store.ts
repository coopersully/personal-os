import {
  type Database,
  notificationAttemptItems,
  notificationDeliveryAttempts,
  textMessages,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import {
  type FinanceActivityEntry,
  type FinanceActivityKind,
  type FinanceActivityQuery,
  financeActivityNotificationEntrySchema,
  financeHumanWorkRefSchema,
  idSchema,
} from "@personal-os/domain";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";

type Attempt = typeof notificationDeliveryAttempts.$inferSelect;
type Message = typeof textMessages.$inferSelect;
export type NotificationActivitySource = {
  attempt: Pick<
    Attempt,
    | "id"
    | "userId"
    | "state"
    | "messageId"
    | "connectionId"
    | "submittedAt"
    | "createdAt"
    | "updatedAt"
  >;
  message: Pick<
    Message,
    | "id"
    | "userId"
    | "connectionId"
    | "direction"
    | "status"
    | "providerSubmittedAt"
    | "deliveredAt"
    | "updatedAt"
  > | null;
  items: Array<typeof notificationAttemptItems.$inferSelect>;
  ownedRunIds: string[];
};
/** Historical transport evidence never establishes an initiating actor or a financial outcome. */
export function projectFinanceNotificationActivity(
  owner: string,
  source: NotificationActivitySource,
) {
  const { attempt, items } = source;
  if (attempt.userId !== owner || items.length > 100) return null;
  if (
    items.some(
      (item) =>
        item.userId !== owner ||
        item.attemptId !== attempt.id ||
        !financeHumanWorkRefSchema.safeParse(item.work).success,
    )
  )
    return null;
  const message =
    source.message?.userId === owner &&
    source.message.id === attempt.messageId &&
    source.message.connectionId === attempt.connectionId &&
    source.message.direction === "outbound"
      ? source.message
      : null;
  const work = items.map((item) => ({
    intentId: item.intentId,
    work: item.work,
    runId:
      item.work.kind === "repair" &&
      idSchema.safeParse(item.work.revision).success &&
      source.ownedRunIds.includes(item.work.revision)
        ? item.work.revision
        : null,
  }));
  const runs = [...new Set(work.flatMap((item) => (item.runId ? [item.runId] : [])))];
  const delivered = message?.status === "delivered" && message.deliveredAt !== null;
  const status = delivered
    ? "delivered"
    : message?.status === "undelivered"
      ? "undelivered"
      : message?.status === "failed"
        ? "failed"
        : attempt.state;
  const descriptions = {
    claimed: "Notification claimed. Provider submission is not confirmed.",
    submitting:
      "Notification submission is in progress. Its outcome is not confirmed; do not resend.",
    accepted: "The provider accepted this notification. Delivery is not confirmed.",
    uncertain:
      "Notification submission is uncertain. The message may already have been sent; do not resend.",
    failed: "Notification transport failed. This does not establish a financial outcome.",
    suppressed: "Notification was suppressed. No delivery is established by this attempt.",
    delivered:
      "The provider reports delivery. This does not prove reading, reply consumption or financial completion.",
    undelivered:
      "The provider reports the notification was not delivered. This does not establish a financial outcome.",
  };
  return financeActivityNotificationEntrySchema.parse({
    id: attempt.id,
    occurredAt: attempt.createdAt.toISOString(),
    kind: "notification_delivery",
    status,
    actor: null,
    action: "Finance notification",
    explanation: descriptions[status],
    caseId: null,
    runId: null,
    actionId: null,
    sourceOperationId: null,
    auditEventIds: [],
    sourceMessages: [],
    changes: [],
    recordRefs: work.map((item) => ({ kind: "notification_work", id: item.work.id })),
    targets: runs.map((id) => ({ kind: "run", id })),
    delivery: {
      attemptId: attempt.id,
      attemptState: attempt.state,
      observedAt: new Date(
        Math.max(attempt.updatedAt.getTime(), message?.updatedAt.getTime() ?? 0),
      ).toISOString(),
      messageId: message?.id ?? null,
      messageStatus: message?.status ?? null,
      submittedAt: message?.providerSubmittedAt?.toISOString() ?? null,
      deliveredAt: delivered && message?.deliveredAt ? message.deliveredAt.toISOString() : null,
      evidenceState:
        items.length > 0 &&
        (!attempt.messageId || message !== null) &&
        work.every((item) => item.work.kind !== "repair" || item.runId !== null)
          ? "complete"
          : "partial",
      work,
    },
  });
}

type Position = { at: string; id: string; kind?: FinanceActivityKind };
export async function listFinanceNotificationActivity(
  db: Database,
  owner: string,
  query: FinanceActivityQuery,
  cursor: Position | null,
) {
  if (query.actor || (query.type && query.type !== "notification_delivery")) return [];
  const attempts = await db
    .select({
      attempt: notificationDeliveryAttempts,
      cursorAt: sql<string>`to_char(${notificationDeliveryAttempts.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    })
    .from(notificationDeliveryAttempts)
    .where(
      and(
        eq(notificationDeliveryAttempts.userId, owner),
        // Membership is frozen on the attempt. Current intent state must not rewrite history.
        sql`exists (select 1 from notification_attempt_items i where i.user_id = ${owner} and i.attempt_id = ${notificationDeliveryAttempts.id} and i.work->>'domain' = 'finances')`,
        query.recordId
          ? sql`exists (select 1 from notification_attempt_items i where i.user_id = ${owner} and i.attempt_id = ${notificationDeliveryAttempts.id} and (i.work->>'id' = ${query.recordId} or (i.work->>'kind' = 'repair' and i.work->>'revision' = ${query.recordId} and exists (select 1 from workspace_maintenance_runs r where r.user_id = ${owner} and r.domain = 'finances' and r.id::text = i.work->>'revision'))))`
          : undefined,
        query.from
          ? sql`${notificationDeliveryAttempts.createdAt} >= ${query.from}::timestamptz`
          : undefined,
        query.through
          ? sql`${notificationDeliveryAttempts.createdAt} <= ${query.through}::timestamptz`
          : undefined,
        cursor
          ? or(
              sql`${notificationDeliveryAttempts.createdAt} < ${cursor.at}::timestamptz`,
              and(
                sql`${notificationDeliveryAttempts.createdAt} = ${cursor.at}::timestamptz`,
                lt(notificationDeliveryAttempts.id, cursor.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(notificationDeliveryAttempts.createdAt), desc(notificationDeliveryAttempts.id))
    .limit(query.limit + 1);
  return Promise.all(
    attempts.map(async ({ attempt, cursorAt }) => {
      const items = await db
        .select()
        .from(notificationAttemptItems)
        .where(
          and(
            eq(notificationAttemptItems.userId, owner),
            eq(notificationAttemptItems.attemptId, attempt.id),
          ),
        )
        .limit(101);
      const [message] = attempt.messageId
        ? await db
            .select({
              id: textMessages.id,
              userId: textMessages.userId,
              connectionId: textMessages.connectionId,
              direction: textMessages.direction,
              status: textMessages.status,
              providerSubmittedAt: textMessages.providerSubmittedAt,
              deliveredAt: textMessages.deliveredAt,
              updatedAt: textMessages.updatedAt,
            })
            .from(textMessages)
            .where(
              and(
                eq(textMessages.userId, owner),
                eq(textMessages.id, attempt.messageId),
                attempt.connectionId
                  ? eq(textMessages.connectionId, attempt.connectionId)
                  : sql`false`,
                eq(textMessages.direction, "outbound"),
              ),
            )
        : [];
      const runIds = items.flatMap((item) =>
        item.work.kind === "repair" && idSchema.safeParse(item.work.revision).success
          ? [item.work.revision]
          : [],
      );
      const runs = runIds.length
        ? await db
            .select({ id: workspaceMaintenanceRuns.id })
            .from(workspaceMaintenanceRuns)
            .where(
              and(
                eq(workspaceMaintenanceRuns.userId, owner),
                eq(workspaceMaintenanceRuns.domain, "finances"),
                inArray(workspaceMaintenanceRuns.id, runIds),
              ),
            )
        : [];
      const entry: FinanceActivityEntry | null = projectFinanceNotificationActivity(owner, {
        attempt,
        items,
        message: message ?? null,
        ownedRunIds: runs.map((run) => run.id),
      });
      return { entry, cursorAt, id: attempt.id, kind: "notification_delivery" as const };
    }),
  );
}
