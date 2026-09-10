import type { MailSyncResult } from "@personal-os/connectors";
import {
  calendarAccounts,
  type Database,
  desktopMailActivity,
  desktopMailState,
  mailboxes,
  mailThreads,
  users,
} from "@personal-os/database";
import type { DesktopActivityPage } from "@personal-os/domain";
import { and, asc, desc, eq, gt, isNull, lte } from "drizzle-orm";

/** Record only a successful projection. Serialize by user before allocating feed sequence IDs. */
export async function recordDesktopMailSync(
  db: Database,
  userId: string,
  accountId: string,
  threads: MailSyncResult["value"]["threads"],
  now: Date,
) {
  await db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
    const [baseline] = await tx
      .select()
      .from(desktopMailState)
      .where(eq(desktopMailState.accountId, accountId));
    const inboxes = await tx
      .select({ id: mailboxes.remoteMailboxId })
      .from(mailboxes)
      .where(
        and(
          eq(mailboxes.accountId, accountId),
          eq(mailboxes.role, "inbox"),
          isNull(mailboxes.deletedAt),
        ),
      );
    for (const thread of threads) {
      const [stored] = await tx
        .select({ id: mailThreads.id, mailboxes: mailThreads.remoteMailboxIds })
        .from(mailThreads)
        .where(
          and(
            eq(mailThreads.accountId, accountId),
            eq(mailThreads.remoteThreadId, thread.remoteThreadId),
            isNull(mailThreads.deletedAt),
          ),
        );
      if (!stored) continue;
      for (const message of thread.messages ?? []) {
        await tx
          .insert(desktopMailActivity)
          .values({
            userId,
            accountId,
            threadId: stored.id,
            remoteMessageId: message.remoteMessageId,
            receivedAt: message.receivedAt,
            eligible: Boolean(
              baseline &&
                message.receivedAt >= baseline.establishedAt &&
                inboxes.some(
                  (inbox) =>
                    stored.mailboxes.includes(inbox.id) &&
                    (message.mailboxIds ?? stored.mailboxes).includes(inbox.id),
                ),
            ),
          })
          .onConflictDoNothing({
            target: [desktopMailActivity.accountId, desktopMailActivity.remoteMessageId],
          });
      }
    }
    await tx
      .insert(desktopMailState)
      .values({ accountId, establishedAt: now })
      .onConflictDoNothing();
  });
}
export function createDesktopActivityService(db: Database) {
  return {
    async list(
      userId: string,
      cursor: string | undefined,
      limit = 50,
    ): Promise<DesktopActivityPage> {
      const [last] = await db
        .select({ sequence: desktopMailActivity.sequence })
        .from(desktopMailActivity)
        .where(eq(desktopMailActivity.userId, userId))
        .orderBy(desc(desktopMailActivity.sequence))
        .limit(1);
      const head = last?.sequence ?? 0n;
      if (cursor === undefined || BigInt(cursor) > head)
        return { events: [], cursor: head.toString(), hasMore: false };
      const rows = await db
        .select({
          activity: desktopMailActivity,
          subject: mailThreads.subject,
          sender: mailThreads.from,
        })
        .from(desktopMailActivity)
        .innerJoin(mailThreads, eq(mailThreads.id, desktopMailActivity.threadId))
        .innerJoin(calendarAccounts, eq(calendarAccounts.id, desktopMailActivity.accountId))
        .where(
          and(
            eq(desktopMailActivity.userId, userId),
            eq(desktopMailActivity.eligible, true),
            gt(desktopMailActivity.sequence, BigInt(cursor)),
            lte(desktopMailActivity.sequence, head),
            isNull(mailThreads.deletedAt),
            eq(calendarAccounts.mailEnabled, true),
          ),
        )
        .orderBy(asc(desktopMailActivity.sequence))
        .limit(limit + 1);
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      return {
        events: page.map(({ activity, subject, sender }) => ({
          id: activity.sequence.toString(),
          kind: "mail_received",
          accountId: activity.accountId,
          threadId: activity.threadId,
          receivedAt: activity.receivedAt.toISOString(),
          subject,
          sender: sender.name ?? sender.address,
        })),
        cursor: (hasMore ? (page.at(-1)?.activity.sequence ?? head) : head).toString(),
        hasMore,
      };
    },
  };
}
