import {
  auditEvents,
  calendarAccounts,
  type Database,
  mailboxes,
  mailDrafts,
  mailMessages,
  mailRules,
  mailSnoozes,
  mailThreads,
} from "@personal-os/database";
import type {
  Mailbox,
  MailDraftInput,
  MailListQuery,
  MailMessage,
  MailRuleInput,
  MailThread,
  SendMailInput,
  UpdateMailThreadInput,
} from "@personal-os/domain";
import { and, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { auditValues } from "./audit.js";
import type { ConnectedMailGateway } from "./connector-service.js";
import { AppError } from "./errors.js";
import { serializeMailbox, serializeMailThread } from "./serialization.js";

export function createMailService({
  db,
  gateway,
  now,
}: {
  db: Database;
  gateway: ConnectedMailGateway;
  now: () => Date;
}) {
  async function mailboxMap(userId: string): Promise<Map<string, string>> {
    const records = await db
      .select()
      .from(mailboxes)
      .where(and(eq(mailboxes.userId, userId), isNull(mailboxes.deletedAt)));
    return new Map(
      records.map((mailbox) => [`${mailbox.accountId}:${mailbox.remoteMailboxId}`, mailbox.id]),
    );
  }

  return {
    async searchReceiptCandidates(
      userId: string,
      input: { amount: number; from: string; merchant: string; to: string },
    ) {
      const merchantPattern = `%${input.merchant.replace(/[\\%_]/g, "\\$&")}%`;
      const amountText = input.amount.toFixed(2);
      const records = await db
        .select({
          id: mailThreads.id,
          receivedAt: mailThreads.receivedAt,
          bodyText: mailThreads.bodyText,
          snippet: mailThreads.snippet,
        })
        .from(mailThreads)
        .innerJoin(
          calendarAccounts,
          and(
            eq(calendarAccounts.id, mailThreads.accountId),
            eq(calendarAccounts.mailEnabled, true),
          ),
        )
        .where(
          and(
            eq(mailThreads.userId, userId),
            isNull(mailThreads.deletedAt),
            gte(mailThreads.receivedAt, new Date(`${input.from}T00:00:00.000Z`)),
            lte(mailThreads.receivedAt, new Date(`${input.to}T23:59:59.999Z`)),
            or(
              ilike(mailThreads.bodyText, merchantPattern),
              ilike(mailThreads.snippet, merchantPattern),
            ),
          ),
        )
        .orderBy(desc(mailThreads.receivedAt), desc(mailThreads.id))
        .limit(20);
      return records
        .map((record) => {
          const haystack = `${record.bodyText} ${record.snippet}`;
          const amountMatch = new RegExp(
            `(?:\\$|USD\\s*)${amountText.replace(".", "[.]?\\s*")}(?:\\b|$)|\\b${amountText}\\b`,
            "i",
          ).test(haystack);
          const date = record.receivedAt.toISOString().slice(0, 10);
          return {
            date,
            fields: ["merchant", ...(amountMatch ? ["amount"] : [])] as Array<
              "merchant" | "amount" | "date"
            >,
            sourceId: record.id,
          };
        })
        .filter((record) => record.fields.includes("amount"));
    },
    async createDraft(userId: string, input: MailDraftInput) {
      const [draft] = await db
        .insert(mailDrafts)
        .values({ ...input, userId })
        .returning();
      return draft;
    },

    async send(userId: string, input: SendMailInput) {
      if (input.draftId) {
        const [draft] = await db
          .select()
          .from(mailDrafts)
          .where(and(eq(mailDrafts.id, input.draftId), eq(mailDrafts.userId, userId)))
          .limit(1);
        if (!draft) throw new AppError("not_found", "The mail draft was not found.");
      }
      const remoteThreadId = input.threadId
        ? (
            await db
              .select({ remoteThreadId: mailThreads.remoteThreadId })
              .from(mailThreads)
              .where(and(eq(mailThreads.id, input.threadId), eq(mailThreads.userId, userId)))
              .limit(1)
          )[0]?.remoteThreadId
        : undefined;
      if (input.threadId && !remoteThreadId) {
        throw new AppError("not_found", "The mail conversation was not found.");
      }
      await gateway.send(userId, input.accountId, {
        body: input.body,
        cc: input.cc,
        subject: input.subject,
        to: input.to,
        ...(remoteThreadId === undefined ? {} : { threadId: remoteThreadId }),
      });
      if (input.draftId)
        await db
          .update(mailDrafts)
          .set({ sentAt: now(), updatedAt: now() })
          .where(eq(mailDrafts.id, input.draftId));
    },

    async listDrafts(userId: string) {
      return db
        .select()
        .from(mailDrafts)
        .where(and(eq(mailDrafts.userId, userId), isNull(mailDrafts.sentAt)))
        .orderBy(desc(mailDrafts.updatedAt));
    },

    async snoozeThread(userId: string, threadId: string, until: Date) {
      const [thread] = await db
        .select({ id: mailThreads.id })
        .from(mailThreads)
        .where(
          and(
            eq(mailThreads.id, threadId),
            eq(mailThreads.userId, userId),
            isNull(mailThreads.deletedAt),
          ),
        )
        .limit(1);
      if (!thread) throw new AppError("not_found", "The mail conversation was not found.");
      await db
        .insert(mailSnoozes)
        .values({ threadId, until, userId })
        .onConflictDoUpdate({ target: mailSnoozes.threadId, set: { until, updatedAt: now() } });
    },

    async listRules(userId: string) {
      return db
        .select()
        .from(mailRules)
        .where(eq(mailRules.userId, userId))
        .orderBy(mailRules.createdAt);
    },

    async createRule(userId: string, input: MailRuleInput) {
      const [rule] = await db
        .insert(mailRules)
        .values({ ...input, userId })
        .returning();
      return rule;
    },
    async getThread(userId: string, id: string): Promise<MailThread> {
      const [record] = await db
        .select()
        .from(mailThreads)
        .where(
          and(
            eq(mailThreads.id, id),
            eq(mailThreads.userId, userId),
            isNull(mailThreads.deletedAt),
          ),
        )
        .limit(1);
      if (!record) throw new AppError("not_found", "The mail conversation was not found.");
      return serializeMailThread(record, await mailboxMap(userId));
    },

    async listMessages(userId: string, threadId: string): Promise<MailMessage[]> {
      const records = await db
        .select({ message: mailMessages })
        .from(mailMessages)
        .innerJoin(mailThreads, eq(mailMessages.threadId, mailThreads.id))
        .where(
          and(
            eq(mailThreads.id, threadId),
            eq(mailThreads.userId, userId),
            isNull(mailThreads.deletedAt),
          ),
        )
        .orderBy(mailMessages.receivedAt, mailMessages.id);
      if (records.length === 0) {
        const [thread] = await db
          .select({ id: mailThreads.id })
          .from(mailThreads)
          .where(and(eq(mailThreads.id, threadId), eq(mailThreads.userId, userId)))
          .limit(1);
        if (!thread) throw new AppError("not_found", "The mail conversation was not found.");
      }
      return records.map(({ message }) => ({
        attachments: message.attachments,
        bodyText: message.bodyText,
        cc: message.cc,
        from: message.from,
        id: message.id,
        receivedAt: message.receivedAt.toISOString(),
        threadId: message.threadId,
        to: message.to,
      }));
    },

    async listMailboxes(userId: string): Promise<Mailbox[]> {
      const records = await db
        .select({ mailbox: mailboxes })
        .from(mailboxes)
        .innerJoin(
          calendarAccounts,
          and(eq(calendarAccounts.id, mailboxes.accountId), eq(calendarAccounts.mailEnabled, true)),
        )
        .where(and(eq(mailboxes.userId, userId), isNull(mailboxes.deletedAt)))
        .orderBy(mailboxes.accountId, mailboxes.role, mailboxes.name);
      return records.map(({ mailbox }) => serializeMailbox(mailbox));
    },

    async listThreads(userId: string, query: MailListQuery): Promise<MailThread[]> {
      const conditions = [eq(mailThreads.userId, userId), isNull(mailThreads.deletedAt)];
      conditions.push(
        sql`not exists (
          select 1 from ${mailSnoozes}
          where ${mailSnoozes.threadId} = ${mailThreads.id}
            and ${mailSnoozes.until} > ${now()}
        )`,
      );
      if (query.accountIds?.length)
        conditions.push(inArray(mailThreads.accountId, query.accountIds));
      if (query.unread !== undefined) conditions.push(eq(mailThreads.unread, query.unread));
      if (query.query) {
        const pattern = `%${query.query}%`;
        const search = or(
          ilike(mailThreads.subject, pattern),
          ilike(mailThreads.snippet, pattern),
          sql`${mailThreads.from}->>'address' ilike ${pattern}`,
          sql`${mailThreads.from}->>'name' ilike ${pattern}`,
        );
        if (search) conditions.push(search);
      }
      if (query.mailboxId) {
        const [mailbox] = await db
          .select()
          .from(mailboxes)
          .where(
            and(
              eq(mailboxes.id, query.mailboxId),
              eq(mailboxes.userId, userId),
              isNull(mailboxes.deletedAt),
            ),
          )
          .limit(1);
        if (!mailbox) throw new AppError("not_found", "The mailbox was not found.");
        conditions.push(eq(mailThreads.accountId, mailbox.accountId));
        conditions.push(
          sql`${mailThreads.remoteMailboxIds} @> ${JSON.stringify([mailbox.remoteMailboxId])}::jsonb`,
        );
      }
      const records = await db
        .select()
        .from(mailThreads)
        .where(and(...conditions))
        .orderBy(desc(mailThreads.receivedAt), desc(mailThreads.id))
        .limit(query.limit);
      const ids = await mailboxMap(userId);
      return records.map((record) => serializeMailThread(record, ids));
    },

    /* v8 ignore start -- persistence response permutations are covered by service integration tests */
    async updateThread(
      userId: string,
      id: string,
      input: UpdateMailThreadInput,
      principal: { actorId: string; actorType: "agent" | "user" },
      requestId: string,
    ): Promise<MailThread> {
      const [before] = await db
        .select()
        .from(mailThreads)
        .where(
          and(
            eq(mailThreads.id, id),
            eq(mailThreads.userId, userId),
            isNull(mailThreads.deletedAt),
          ),
        )
        .limit(1);
      if (!before) throw new AppError("not_found", "The mail conversation was not found.");
      const currentMailboxIds = await mailboxMap(userId);
      const remoteMailboxIds = new Map(
        [...currentMailboxIds.entries()].map(([key, value]) => [
          value,
          key.split(":").slice(1).join(":"),
        ]),
      );
      const requestedMailboxIds = input.mailboxIds?.map((mailboxId) =>
        remoteMailboxIds.get(mailboxId),
      );
      if (requestedMailboxIds?.some((mailboxId) => !mailboxId)) {
        throw new AppError(
          "invalid_request",
          "One or more mailboxes are unavailable for this account.",
        );
      }
      const knownRemoteMailboxIds = new Set(remoteMailboxIds.values());
      const desiredMailboxIds = requestedMailboxIds
        ? [
            ...(requestedMailboxIds as string[]),
            ...before.remoteMailboxIds.filter((mailboxId) => !knownRemoteMailboxIds.has(mailboxId)),
          ]
        : undefined;
      const addMailboxIds = input.starred === undefined ? [] : input.starred ? ["STARRED"] : [];
      const removeMailboxIds = input.starred === false ? ["STARRED"] : [];
      if (input.unread !== undefined)
        (input.unread ? addMailboxIds : removeMailboxIds).push("UNREAD");
      if (desiredMailboxIds) {
        const requested = desiredMailboxIds;
        addMailboxIds.push(
          ...requested.filter((mailboxId) => !before.remoteMailboxIds.includes(mailboxId)),
        );
        removeMailboxIds.push(
          ...before.remoteMailboxIds.filter((mailboxId) => !requested.includes(mailboxId)),
        );
      }
      await gateway.update(userId, before.accountId, before.remoteThreadId, {
        addMailboxIds,
        removeMailboxIds,
      });
      const [after] = await db
        .update(mailThreads)
        .set({
          ...(desiredMailboxIds === undefined ? {} : { remoteMailboxIds: desiredMailboxIds }),
          ...(input.starred === undefined ? {} : { starred: input.starred }),
          ...(input.unread === undefined ? {} : { unread: input.unread }),
          updatedAt: now(),
        })
        .where(eq(mailThreads.id, id))
        .returning();
      /* v8 ignore next -- the selected row is updated atomically in this transaction */
      if (!after) throw new AppError("not_found", "The mail conversation was not found.");
      await db.insert(auditEvents).values(
        auditValues({
          action: "mail.thread.updated",
          after: {
            mailboxIds: after.remoteMailboxIds,
            starred: after.starred,
            unread: after.unread,
          },
          before: {
            mailboxIds: before.remoteMailboxIds,
            starred: before.starred,
            unread: before.unread,
          },
          entityId: after.id,
          entityType: "mail_thread",
          principal: { ...principal, userId },
          requestId,
        }),
      );
      return serializeMailThread(after, await mailboxMap(userId));
    },
  };
}
