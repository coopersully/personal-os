import {
  auditEvents,
  calendarAccounts,
  type Database,
  domainProfiles,
  mailboxes,
  mailDrafts,
  mailMessages,
  mailRules,
  mailSnoozes,
  mailThreads,
} from "@personal-os/database";
import type {
  CreateMailRuleInput,
  Mailbox,
  MailDraftInput,
  MailListQuery,
  MailMessage,
  MailRule,
  MailThread,
  PreviewMailRuleInput,
  SendMailInput,
  UpdateMailRuleInput,
  UpdateMailThreadInput,
} from "@personal-os/domain";
import { mailRuleActionIsDue, matchesMailRule, resolveStoredMailRule } from "@personal-os/domain";
import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { auditValues } from "./audit.js";
import type { ConnectedMailGateway } from "./connector-service.js";
import { requireDatabaseRecord } from "./database.js";
import { AppError } from "./errors.js";
import { auditSnapshot, serializeMailbox, serializeMailThread } from "./serialization.js";
import type { Principal } from "./types.js";

type MutationContext = { principal: Principal; requestId: string };

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

  async function validateRuleReferences(
    userId: string,
    input: Pick<CreateMailRuleInput, "actions" | "profileId" | "sourceIds">,
  ): Promise<void> {
    if (input.profileId) {
      const profile = (
        await db
          .select({ id: domainProfiles.id })
          .from(domainProfiles)
          .where(
            and(
              eq(domainProfiles.id, input.profileId),
              eq(domainProfiles.userId, userId),
              eq(domainProfiles.domain, "mail"),
            ),
          )
          .limit(1)
      )[0];
      if (!profile) throw new AppError("not_found", "The mail profile was not found.");
    }
    if (input.sourceIds.length > 0) {
      const sources = await db
        .select({ id: calendarAccounts.id })
        .from(calendarAccounts)
        .where(
          and(
            eq(calendarAccounts.userId, userId),
            eq(calendarAccounts.mailEnabled, true),
            inArray(calendarAccounts.id, input.sourceIds),
          ),
        );
      if (sources.length !== new Set(input.sourceIds).size) {
        throw new AppError("invalid_request", "A selected mail account is unavailable.");
      }
    }
    const mailboxIds = input.actions.flatMap((action) =>
      action.type === "add_label" && action.mailboxId ? [action.mailboxId] : [],
    );
    if (mailboxIds.length === 0) return;
    const destinations = await db
      .select({ accountId: mailboxes.accountId, id: mailboxes.id })
      .from(mailboxes)
      .where(
        and(
          eq(mailboxes.userId, userId),
          isNull(mailboxes.deletedAt),
          inArray(mailboxes.id, mailboxIds),
        ),
      );
    if (destinations.length !== new Set(mailboxIds).size) {
      throw new AppError("invalid_request", "A selected mail label is unavailable.");
    }
    const destinationAccountIds = new Set(destinations.map((destination) => destination.accountId));
    if (
      input.sourceIds.length !== 1 ||
      destinationAccountIds.size !== 1 ||
      !destinationAccountIds.has(input.sourceIds[0] ?? "")
    ) {
      throw new AppError(
        "invalid_request",
        "A label rule must select exactly the source account that owns the label.",
      );
    }
  }

  return {
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

    async listRules(userId: string): Promise<MailRule[]> {
      const rules = await db
        .select()
        .from(mailRules)
        .where(eq(mailRules.userId, userId))
        .orderBy(mailRules.createdAt);
      return rules.map(serializeMailRule);
    },

    async createRule(input: CreateMailRuleInput, context: MutationContext): Promise<MailRule> {
      await validateRuleReferences(context.principal.userId, input);
      const created = await db.transaction(async (transaction) => {
        const rule = requireDatabaseRecord(
          (
            await transaction
              .insert(mailRules)
              .values({
                actions: input.actions,
                condition: input.condition,
                confidenceThreshold:
                  input.confidenceThreshold === null
                    ? null
                    : Math.round(input.confidenceThreshold * 10_000),
                description: input.description,
                enabled: input.enabled,
                name: input.name,
                policy: input.policy,
                profileId: input.profileId,
                sourceAccountIds: input.sourceIds,
                userId: context.principal.userId,
              })
              .returning()
          )[0],
          "The mail rule could not be created.",
        );
        await transaction.insert(auditEvents).values(
          auditValues({
            action: "mail.rule.created",
            after: auditSnapshot(rule),
            before: null,
            entityId: rule.id,
            entityType: "mail_rule",
            ...context,
          }),
        );
        return rule;
      });
      return serializeMailRule(created);
    },

    async previewRule(userId: string, input: PreviewMailRuleInput) {
      await validateRuleReferences(userId, { ...input, profileId: null });
      const conditions = [
        eq(mailThreads.userId, userId),
        isNull(mailThreads.deletedAt),
        ...(input.sourceIds.length > 0 ? [inArray(mailThreads.accountId, input.sourceIds)] : []),
      ];
      const scanned = await db
        .select()
        .from(mailThreads)
        .where(and(...conditions))
        .orderBy(desc(mailThreads.receivedAt))
        .limit(200);
      const candidates = scanned
        .filter((thread) =>
          matchesMailRule(input.condition, {
            from: thread.from,
            snippet: thread.snippet,
            subject: thread.subject,
          }),
        )
        .map((thread) => ({
          actions: input.actions.map((action) => ({
            ...action,
            due: mailRuleActionIsDue(action, thread.receivedAt, now()),
          })),
          accountId: thread.accountId,
          from: thread.from,
          id: thread.id,
          receivedAt: thread.receivedAt.toISOString(),
          subject: thread.subject,
        }));
      return { candidates, matchedCount: candidates.length, scannedCount: scanned.length };
    },

    async updateRule(
      id: string,
      input: UpdateMailRuleInput,
      context: MutationContext,
    ): Promise<MailRule> {
      const [existing] = await db
        .select()
        .from(mailRules)
        .where(and(eq(mailRules.id, id), eq(mailRules.userId, context.principal.userId)))
        .limit(1);
      if (!existing) throw new AppError("not_found", "The mail rule was not found.");
      if (existing.version !== input.expectedVersion) {
        throw new AppError("conflict", "The mail rule changed since it was loaded.", {
          currentVersion: existing.version,
        });
      }
      const resolvedExisting = resolveStoredMailRule({
        action: existing.legacyAction,
        actions: existing.actions,
        condition: existing.condition,
        enabled: existing.enabled,
        policy: existing.policy,
        query: existing.legacyQuery,
      });
      const nextReferences = {
        actions: input.actions ?? resolvedExisting.actions,
        profileId: input.profileId === undefined ? existing.profileId : input.profileId,
        sourceIds: input.sourceIds ?? existing.sourceAccountIds,
      };
      await validateRuleReferences(context.principal.userId, nextReferences);
      const {
        confidenceThreshold,
        expectedVersion: _expectedVersion,
        sourceIds,
        ...changes
      } = input;
      const updatedAt = now();
      const updated = await db.transaction(async (transaction) => {
        const [rule] = await transaction
          .update(mailRules)
          .set({
            ...changes,
            ...(confidenceThreshold === undefined
              ? {}
              : {
                  confidenceThreshold:
                    confidenceThreshold === null ? null : Math.round(confidenceThreshold * 10_000),
                }),
            ...(sourceIds === undefined ? {} : { sourceAccountIds: sourceIds }),
            updatedAt,
            version: existing.version + 1,
          })
          .where(and(eq(mailRules.id, id), eq(mailRules.version, existing.version)))
          .returning();
        if (!rule) {
          throw new AppError("conflict", "The mail rule changed while it was being saved.");
        }
        await transaction.insert(auditEvents).values(
          auditValues({
            action: "mail.rule.updated",
            after: auditSnapshot(rule),
            before: auditSnapshot(existing),
            entityId: rule.id,
            entityType: "mail_rule",
            ...context,
          }),
        );
        return rule;
      });
      return serializeMailRule(updated);
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

function serializeMailRule(row: typeof mailRules.$inferSelect): MailRule {
  const resolved = resolveStoredMailRule({
    action: row.legacyAction,
    actions: row.actions,
    condition: row.condition,
    enabled: row.enabled,
    policy: row.policy,
    query: row.legacyQuery,
  });
  return {
    actions: resolved.actions,
    condition: resolved.condition,
    confidenceThreshold: row.confidenceThreshold === null ? null : row.confidenceThreshold / 10_000,
    createdAt: row.createdAt.toISOString(),
    description: row.description,
    domain: "mail",
    enabled: row.enabled,
    id: row.id,
    name: row.name,
    policy: resolved.policy,
    profileId: row.profileId,
    sourceIds: row.sourceAccountIds,
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}
