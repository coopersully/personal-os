import { createHmac, timingSafeEqual } from "node:crypto";
import {
  attentionItems,
  auditEvents,
  calendarAccounts,
  type Database,
  domainProfiles,
  mailboxes,
  mailCalendarCommitmentIntakes,
  mailDrafts,
  mailMessages,
  mailRules,
  mailRuleWorkItems,
  mailSnoozes,
  mailThreads,
} from "@personal-os/database";
import type {
  ActivateMailRuleInput,
  AttentionItem,
  BulkUpdateMailInput,
  BulkUpdateMailResult,
  CreateMailRuleInput,
  LegacyMailDraft,
  Mailbox,
  MailListQuery,
  MailMessage,
  MailRule,
  MailRulePreview,
  MailSetupContext,
  MailThread,
  PreviewMailRuleInput,
  UpdateMailRuleInput,
  UpdateMailThreadInput,
  UpsertMailAttentionItemInput,
} from "@personal-os/domain";
import {
  MAIL_RULE_EXECUTION_LIMIT_PER_RUN,
  mailProfilePreferencesSchema,
  mailRuleActionIsDue,
  mailRuleActionsMatchRetentionPreferences,
  matchesMailRule,
  resolveStoredMailRule,
} from "@personal-os/domain";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { auditValues } from "./audit.js";
import { type ConnectedMailGateway, mailProviderPartialEffectError } from "./connector-service.js";
import { connectionHealthForAccount } from "./connector-sync-health.js";
import { requireDatabaseRecord } from "./database.js";
import { AppError } from "./errors.js";
import { enqueueDurableMailRuleWork } from "./mail-rule-work.js";
import {
  auditAttentionItemMetadata,
  auditMailRuleMetadata,
  mailRuleChangedFields,
  serializeMailbox,
  serializeMailThread,
} from "./serialization.js";
import type { Principal } from "./types.js";

type MutationContext = { principal: Principal; requestId: string };
type MailSourceExecutor = Pick<Database, "select">;
type MailRuleUpdateRequest = Omit<UpdateMailRuleInput, "enabled" | "policy"> & {
  enabled?: boolean | undefined;
  policy?: MailRule["policy"] | undefined;
};

export function createMailService({
  db,
  gateway,
  now,
  reviewSigningKey,
}: {
  db: Database;
  gateway: ConnectedMailGateway;
  now: () => Date;
  reviewSigningKey: string;
}) {
  function previewFingerprint(
    preview: Omit<MailRulePreview, "fingerprint">,
    reviewedAt = preview.previewedAt,
  ): string {
    return createHmac("sha256", reviewSigningKey)
      .update(
        JSON.stringify({
          candidates: preview.candidates.map((candidate) => ({
            accountId: candidate.accountId,
            actions: candidate.actions,
            from: candidate.from,
            id: candidate.id,
            receivedAt: candidate.receivedAt,
            subject: candidate.subject,
            updatedAt: candidate.updatedAt,
          })),
          reviewedAt,
          ruleId: preview.ruleId,
          ruleVersion: preview.ruleVersion,
          window: preview.window,
        }),
      )
      .digest("hex");
  }

  function fingerprintsMatch(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left, "hex");
    const rightBuffer = Buffer.from(right, "hex");
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
  }
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
    executor: MailSourceExecutor,
    userId: string,
    input: Pick<CreateMailRuleInput, "actions" | "profileId" | "sourceIds">,
    lockReferences = false,
  ): Promise<void> {
    await validateMailSourceIds(userId, input.sourceIds, executor, lockReferences);
    if (input.profileId) {
      const profileQuery = executor
        .select({ id: domainProfiles.id })
        .from(domainProfiles)
        .where(
          and(
            eq(domainProfiles.id, input.profileId),
            eq(domainProfiles.userId, userId),
            eq(domainProfiles.domain, "mail"),
          ),
        )
        .limit(1);
      const [profile] = lockReferences ? await profileQuery.for("share") : await profileQuery;
      if (!profile) throw new AppError("not_found", "The mail profile was not found.");
    }
    const mailboxIds = input.actions.flatMap((action) =>
      action.type === "add_label" && action.mailboxId ? [action.mailboxId] : [],
    );
    if (mailboxIds.length === 0) return;
    const destinationQuery = executor
      .select({ accountId: mailboxes.accountId, id: mailboxes.id, role: mailboxes.role })
      .from(mailboxes)
      .where(
        and(
          eq(mailboxes.userId, userId),
          isNull(mailboxes.deletedAt),
          inArray(mailboxes.id, mailboxIds),
        ),
      )
      .orderBy(asc(mailboxes.id));
    const destinations = lockReferences
      ? await destinationQuery.for("share")
      : await destinationQuery;
    if (
      destinations.length !== new Set(mailboxIds).size ||
      destinations.some((destination) => destination.role !== "custom")
    ) {
      throw new AppError(
        "invalid_request",
        "add_label requires an available ordinary user label, not a system mailbox.",
      );
    }
    const destinationAccountIds = new Set(destinations.map((destination) => destination.accountId));
    if (
      input.sourceIds.length !== 1 ||
      destinationAccountIds.size !== 1 ||
      !input.sourceIds.every((sourceId) => destinationAccountIds.has(sourceId))
    ) {
      throw new AppError(
        "invalid_request",
        "A label rule must select exactly the source account that owns the label.",
      );
    }
  }

  async function validateMailSourceIds(
    userId: string,
    sourceIds: string[],
    executor: MailSourceExecutor = db,
    lockSources = false,
  ): Promise<void> {
    if (sourceIds.length === 0) return;
    const uniqueSourceIds = [...new Set(sourceIds)];
    const sourceQuery = executor
      .select({ id: calendarAccounts.id })
      .from(calendarAccounts)
      .where(
        and(
          eq(calendarAccounts.userId, userId),
          eq(calendarAccounts.mailEnabled, true),
          inArray(calendarAccounts.id, uniqueSourceIds),
        ),
      )
      .orderBy(asc(calendarAccounts.id));
    const sources = lockSources ? await sourceQuery.for("share") : await sourceQuery;
    if (sources.length !== uniqueSourceIds.length) {
      throw new AppError("invalid_request", "A selected Mail account is unavailable.");
    }
  }

  async function buildRulePreview(
    userId: string,
    input: PreviewMailRuleInput,
    rule: { id: string; version: number } | null = null,
    executor: MailSourceExecutor = db,
    lockThreads = false,
  ): Promise<MailRulePreview> {
    await validateRuleReferences(executor, userId, { ...input, profileId: null }, lockThreads);
    const conditions = [
      eq(mailThreads.userId, userId),
      isNull(mailThreads.deletedAt),
      ...(input.sourceIds.length > 0 ? [inArray(mailThreads.accountId, input.sourceIds)] : []),
    ];
    const scannedQuery = executor
      .select()
      .from(mailThreads)
      .where(and(...conditions))
      .orderBy(desc(mailThreads.receivedAt), desc(mailThreads.id))
      .limit(201);
    const scannedWindow = lockThreads ? await scannedQuery.for("update") : await scannedQuery;
    const scanned = scannedWindow.slice(0, 200);
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
        updatedAt: thread.updatedAt.toISOString(),
      }));
    const preview = {
      candidates,
      matchedCount: candidates.length,
      previewedAt: now().toISOString(),
      ruleId: rule?.id ?? null,
      ruleVersion: rule?.version ?? null,
      scannedCount: scanned.length,
      window: {
        limit: 200 as const,
        newestReceivedAt: scanned[0]?.receivedAt.toISOString() ?? null,
        oldestReceivedAt: scanned.at(-1)?.receivedAt.toISOString() ?? null,
        truncated: scannedWindow.length > 200,
      },
    };
    return {
      ...preview,
      fingerprint: previewFingerprint(preview),
    };
  }

  async function findRule(userId: string, id: string) {
    return (
      await db
        .select()
        .from(mailRules)
        .where(and(eq(mailRules.id, id), eq(mailRules.userId, userId)))
        .limit(1)
    )[0];
  }

  function storedRulePreviewInput(rule: typeof mailRules.$inferSelect): PreviewMailRuleInput {
    const resolved = resolveStoredMailRule({
      action: rule.legacyAction,
      actions: rule.actions,
      condition: rule.condition,
      enabled: rule.enabled,
      policy: rule.policy,
      query: rule.legacyQuery,
    });
    return {
      actions: resolved.actions,
      condition: resolved.condition,
      confidenceThreshold: null,
      description: rule.description,
      sourceIds: rule.sourceAccountIds,
    };
  }

  async function applyThreadUpdate(
    userId: string,
    id: string,
    input: UpdateMailThreadInput,
    principal: { actorId: string; actorType: "agent" | "user" },
    requestId: string,
    knownMailboxIds?: Map<string, string>,
  ): Promise<MailThread> {
    const [before] = await db
      .select()
      .from(mailThreads)
      .where(
        and(eq(mailThreads.id, id), eq(mailThreads.userId, userId), isNull(mailThreads.deletedAt)),
      )
      .limit(1);
    if (!before) throw new AppError("not_found", "The mail conversation was not found.");
    if (
      input.expectedUpdatedAt !== undefined &&
      input.expectedUpdatedAt !== before.updatedAt.toISOString()
    ) {
      throw new AppError(
        "conflict",
        "The mail conversation changed since it was read. Read it again before retrying.",
        { currentUpdatedAt: before.updatedAt.toISOString() },
      );
    }
    const currentMailboxIds = knownMailboxIds ?? (await mailboxMap(userId));
    if (input.mailboxIds && new Set(input.mailboxIds).size !== input.mailboxIds.length) {
      throw new AppError("invalid_request", "Mail conversation mailbox IDs must be unique.");
    }
    const accountMailboxes = await db
      .select({ id: mailboxes.id, remoteMailboxId: mailboxes.remoteMailboxId })
      .from(mailboxes)
      .where(
        and(
          eq(mailboxes.userId, userId),
          eq(mailboxes.accountId, before.accountId),
          isNull(mailboxes.deletedAt),
        ),
      );
    const remoteMailboxIds = new Map(
      accountMailboxes.map((mailbox) => [mailbox.id, mailbox.remoteMailboxId]),
    );
    const requestedMailboxIds = input.mailboxIds?.map((mailboxId) =>
      remoteMailboxIds.get(mailboxId),
    );
    if (requestedMailboxIds?.some((mailboxId) => mailboxId === undefined)) {
      throw new AppError(
        "invalid_request",
        "One or more mailboxes do not belong to this Mail conversation's account.",
      );
    }
    const knownRemoteMailboxIds = new Set(
      accountMailboxes.map((mailbox) => mailbox.remoteMailboxId),
    );
    const desiredMailboxIds = requestedMailboxIds
      ? [
          ...(requestedMailboxIds as string[]),
          ...before.remoteMailboxIds.filter((mailboxId) => !knownRemoteMailboxIds.has(mailboxId)),
        ]
      : undefined;
    const addMailboxIds = input.starred ? ["STARRED"] : [];
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
    try {
      const updatedAt = new Date(Math.max(now().getTime(), before.updatedAt.getTime() + 1));
      const after = await db.transaction(async (transaction) => {
        const [updated] = await transaction
          .update(mailThreads)
          .set({
            ...(desiredMailboxIds === undefined ? {} : { remoteMailboxIds: desiredMailboxIds }),
            ...(input.starred === undefined ? {} : { starred: input.starred }),
            ...(input.unread === undefined ? {} : { unread: input.unread }),
            updatedAt,
          })
          .where(
            and(
              eq(mailThreads.id, id),
              sql`date_trunc('milliseconds', ${mailThreads.updatedAt}) = ${before.updatedAt}`,
            ),
          )
          .returning();
        if (!updated) {
          throw new AppError(
            "conflict",
            "The mail conversation changed while the provider update was in progress.",
          );
        }
        await transaction.insert(auditEvents).values(
          auditValues({
            action: "mail.thread.updated",
            after: {
              mailboxIds: updated.remoteMailboxIds,
              starred: updated.starred,
              unread: updated.unread,
            },
            before: {
              mailboxIds: before.remoteMailboxIds,
              starred: before.starred,
              unread: before.unread,
            },
            entityId: updated.id,
            entityType: "mail_thread",
            principal: { ...principal, userId },
            requestId,
          }),
        );
        return updated;
      });
      return serializeMailThread(after, currentMailboxIds);
    } catch (error) {
      throw mailProviderPartialEffectError({
        accountId: before.accountId,
        cause: error,
        credentialsPersisted: true,
        operation: "thread_update",
        remoteThreadId: before.remoteThreadId,
        threadId: before.id,
      });
    }
  }

  return {
    async validateProfileSources(
      transaction: MailSourceExecutor,
      userId: string,
      sourceIds: string[],
    ): Promise<void> {
      await validateMailSourceIds(userId, sourceIds, transaction, true);
    },

    async deleteLegacyDraft(userId: string, id: string): Promise<void> {
      const [deleted] = await db
        .delete(mailDrafts)
        .where(and(eq(mailDrafts.id, id), eq(mailDrafts.userId, userId)))
        .returning({ id: mailDrafts.id });
      if (deleted === undefined) {
        throw new AppError("not_found", "The historical Mail draft was not found.");
      }
    },

    async listLegacyDrafts(userId: string): Promise<LegacyMailDraft[]> {
      const drafts = await db
        .select()
        .from(mailDrafts)
        .where(eq(mailDrafts.userId, userId))
        .orderBy(desc(mailDrafts.updatedAt));
      return drafts.map(serializeLegacyMailDraft);
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

    async upsertAttentionItem(
      threadId: string,
      input: UpsertMailAttentionItemInput,
      context: MutationContext,
    ): Promise<AttentionItem> {
      const updatedAt = now();
      const saved = await db.transaction(async (transaction) => {
        const thread = (
          await transaction
            .select()
            .from(mailThreads)
            .where(
              and(
                eq(mailThreads.id, threadId),
                eq(mailThreads.userId, context.principal.userId),
                isNull(mailThreads.deletedAt),
              ),
            )
            .for("update")
            .limit(1)
        )[0];
        if (!thread) throw new AppError("not_found", "The mail conversation was not found.");
        const existing = (
          await transaction
            .select()
            .from(attentionItems)
            .where(
              and(
                eq(attentionItems.userId, context.principal.userId),
                eq(attentionItems.domain, "mail"),
                eq(attentionItems.relatedEntityId, thread.id),
                eq(attentionItems.relatedEntityType, "mail_thread"),
                eq(attentionItems.kind, input.kind),
                eq(attentionItems.status, "open"),
              ),
            )
            .for("update")
            .limit(1)
        )[0];
        const values = {
          domain: "mail" as const,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          importance: input.importance,
          kind: input.kind,
          occursAt: input.occursAt ? new Date(input.occursAt) : null,
          relatedEntityId: thread.id,
          relatedEntityType: "mail_thread",
          source: {
            accountId: thread.accountId,
            provider: thread.provider,
            remoteId: thread.remoteThreadId,
            revision: thread.updatedAt.toISOString(),
            sourceType: "mail_thread" as const,
          },
          status: "open" as const,
          summary: input.summary,
          title: input.title,
          userId: context.principal.userId,
        };
        const item = requireDatabaseRecord(
          (existing
            ? await transaction
                .update(attentionItems)
                .set({ ...values, updatedAt, version: existing.version + 1 })
                .where(
                  and(
                    eq(attentionItems.id, existing.id),
                    eq(attentionItems.version, existing.version),
                  ),
                )
                .returning()
            : await transaction.insert(attentionItems).values(values).returning())[0],
          "The Mail attention item could not be saved.",
        );
        await transaction.insert(auditEvents).values(
          auditValues({
            action: existing ? "assistant.attention.updated" : "assistant.attention.created",
            after: auditAttentionItemMetadata(item),
            before: auditAttentionItemMetadata(existing ?? null),
            entityId: item.id,
            entityType: "attention_item",
            ...context,
          }),
        );
        return item;
      });
      return serializeMailAttentionItem(saved);
    },

    async listSetupContext(userId: string): Promise<MailSetupContext> {
      const [accounts, mailboxRecords, workSummaries, [commitmentIntakeSummary]] =
        await Promise.all([
          db
            .select()
            .from(calendarAccounts)
            .where(and(eq(calendarAccounts.userId, userId), eq(calendarAccounts.mailEnabled, true)))
            .orderBy(asc(calendarAccounts.createdAt)),
          db
            .select()
            .from(mailboxes)
            .where(and(eq(mailboxes.userId, userId), isNull(mailboxes.deletedAt)))
            .orderBy(asc(mailboxes.accountId), asc(mailboxes.role), asc(mailboxes.name)),
          db
            .select({
              accountId: mailRuleWorkItems.accountId,
              count: sql<number>`count(*)::int`,
              lastCompletedAt: sql<Date | string | null>`max(${mailRuleWorkItems.completedAt})`,
              oldestDueAt: sql<Date | string | null>`min(
              case
                when ${mailRuleWorkItems.status} in ('pending', 'claimed', 'reconcile')
                then ${mailRuleWorkItems.dueAt}
                else null
              end
            )`,
              status: mailRuleWorkItems.status,
            })
            .from(mailRuleWorkItems)
            .innerJoin(
              calendarAccounts,
              and(
                eq(calendarAccounts.id, mailRuleWorkItems.accountId),
                eq(calendarAccounts.userId, userId),
                eq(calendarAccounts.mailEnabled, true),
              ),
            )
            .where(eq(mailRuleWorkItems.userId, userId))
            .groupBy(mailRuleWorkItems.accountId, mailRuleWorkItems.status),
          db
            .select({
              previewOnlyCount: sql<number>`count(*) filter (
                where ${mailCalendarCommitmentIntakes.status} = 'preview_only'
              )::int`,
            })
            .from(mailCalendarCommitmentIntakes)
            .innerJoin(
              calendarAccounts,
              and(
                eq(calendarAccounts.id, mailCalendarCommitmentIntakes.accountId),
                eq(calendarAccounts.userId, userId),
                eq(calendarAccounts.mailEnabled, true),
              ),
            )
            .where(eq(mailCalendarCommitmentIntakes.userId, userId)),
        ]);
      const mailboxesByAccount = new Map<string, Mailbox[]>();
      for (const mailbox of mailboxRecords) {
        const group = mailboxesByAccount.get(mailbox.accountId) ?? [];
        group.push(serializeMailbox(mailbox));
        mailboxesByAccount.set(mailbox.accountId, group);
      }
      const automationByAccount = new Map<
        string,
        MailSetupContext["accounts"][number]["automation"]
      >();
      let oldestDueAt: Date | null = null;
      let lastCompletedAt: Date | null = null;
      let failedCount = 0;
      let inProgressCount = 0;
      let pendingCount = 0;
      let reconciliationCount = 0;
      const toDate = (value: Date | string | null): Date | null =>
        value instanceof Date ? value : value ? new Date(value) : null;
      for (const summary of workSummaries) {
        const summaryCompletedAt = toDate(summary.lastCompletedAt);
        const summaryOldestDueAt = toDate(summary.oldestDueAt);
        const current = automationByAccount.get(summary.accountId) ?? {
          failedCount: 0,
          inProgressCount: 0,
          lastCompletedAt: null,
          pendingCount: 0,
          reconciliationCount: 0,
        };
        if (summary.status === "failed") {
          current.failedCount += summary.count;
          failedCount += summary.count;
        }
        if (summary.status === "claimed") {
          current.inProgressCount += summary.count;
          inProgressCount += summary.count;
        }
        if (summary.status === "pending") {
          current.pendingCount += summary.count;
          pendingCount += summary.count;
        }
        if (summary.status === "reconcile") {
          current.reconciliationCount += summary.count;
          reconciliationCount += summary.count;
        }
        if (
          summaryCompletedAt &&
          (!current.lastCompletedAt ||
            summaryCompletedAt.getTime() > new Date(current.lastCompletedAt).getTime())
        ) {
          current.lastCompletedAt = summaryCompletedAt.toISOString();
        }
        if (
          summaryCompletedAt &&
          (!lastCompletedAt || summaryCompletedAt.getTime() > lastCompletedAt.getTime())
        ) {
          lastCompletedAt = summaryCompletedAt;
        }
        if (
          summaryOldestDueAt &&
          (!oldestDueAt || summaryOldestDueAt.getTime() < oldestDueAt.getTime())
        ) {
          oldestDueAt = summaryOldestDueAt;
        }
        automationByAccount.set(summary.accountId, current);
      }
      return {
        accounts: accounts.map((account) => ({
          accountId: account.id,
          automation: automationByAccount.get(account.id) ?? {
            failedCount: 0,
            inProgressCount: 0,
            lastCompletedAt: null,
            pendingCount: 0,
            reconciliationCount: 0,
          },
          automaticRuleExecution: account.provider === "google",
          email: account.email,
          health: connectionHealthForAccount(account),
          label: account.label,
          lastSyncAttemptAt: account.lastSyncAttemptAt?.toISOString() ?? null,
          lastSyncedAt: account.lastSyncedAt?.toISOString() ?? null,
          mailboxes: mailboxesByAccount.get(account.id) ?? [],
          provider: account.provider as "google" | "icloud",
          nextSyncAt: account.nextSyncAt?.toISOString() ?? null,
          syncError: account.syncError,
          syncStatus: account.syncStatus,
        })),
        automation: {
          executionLimitPerRun: MAIL_RULE_EXECUTION_LIMIT_PER_RUN,
          failedCount,
          inProgressCount,
          lastCompletedAt: lastCompletedAt?.toISOString() ?? null,
          oldestDueAt: oldestDueAt?.toISOString() ?? null,
          pendingCount,
          reconciliationCount,
        },
        commitmentIntake: {
          automaticCreationEnabled: false,
          previewOnlyCount: commitmentIntakeSummary?.previewOnlyCount ?? 0,
          serverVerifiedCount: 0,
        },
        safety: {
          delayedRetentionAutomation: true,
          permanentDeletion: false,
          providerFilterCreation: false,
          spamClassification: false,
          unsubscribeAutomation: false,
        },
      };
    },

    async createRule(input: CreateMailRuleInput, context: MutationContext): Promise<MailRule> {
      const created = await db.transaction(async (transaction) => {
        await validateRuleReferences(transaction, context.principal.userId, input, true);
        const rule = requireDatabaseRecord(
          (
            await transaction
              .insert(mailRules)
              .values({
                actions: input.actions,
                condition: input.condition,
                confidenceThreshold: null,
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
            after: auditMailRuleMetadata(rule, mailRuleChangedFields(null, rule)),
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

    async previewRule(userId: string, input: PreviewMailRuleInput): Promise<MailRulePreview> {
      return buildRulePreview(userId, input);
    },

    async previewSavedRule(userId: string, id: string): Promise<MailRulePreview> {
      const rule = await findRule(userId, id);
      if (!rule) throw new AppError("not_found", "The mail rule was not found.");
      return buildRulePreview(userId, storedRulePreviewInput(rule), rule);
    },

    async activateRule(
      id: string,
      input: ActivateMailRuleInput,
      context: MutationContext,
    ): Promise<{ preview: MailRulePreview; rule: MailRule }> {
      if (context.principal.actorType !== "user") {
        throw new AppError(
          "forbidden",
          "Mail rule activation requires an interactive user session.",
        );
      }
      const existing = await findRule(context.principal.userId, id);
      if (!existing) throw new AppError("not_found", "The mail rule was not found.");
      if (existing.version !== input.expectedVersion) {
        throw new AppError("conflict", "The mail rule changed since it was reviewed.", {
          currentVersion: existing.version,
        });
      }
      const previewAgeMs = now().getTime() - new Date(input.expectedPreviewedAt).getTime();
      if (previewAgeMs < -60_000 || previewAgeMs > 15 * 60_000) {
        throw new AppError(
          "conflict",
          "The Mail rule review expired. Review the current bounded sample before activation.",
          { currentVersion: existing.version },
        );
      }
      const resolved = resolveStoredMailRule({
        action: existing.legacyAction,
        actions: existing.actions,
        condition: existing.condition,
        enabled: existing.enabled,
        policy: existing.policy,
        query: existing.legacyQuery,
      });
      if (
        resolved.actions.some((action) => action.type === "trash") &&
        resolved.actions.length > 1
      ) {
        throw new AppError(
          "invalid_request",
          "A recoverable Trash rule must use Trash as its only action so the provider effect has one unambiguous recovery path.",
        );
      }
      if (existing.enabled && resolved.policy === "approved_rule") {
        throw new AppError("invalid_request", "The Mail rule is already active.");
      }
      if (!existing.profileId) {
        throw new AppError(
          "invalid_request",
          "Link an active Mail profile before activating this rule.",
        );
      }
      if (
        existing.sourceAccountIds.length === 0 ||
        new Set(existing.sourceAccountIds).size !== existing.sourceAccountIds.length
      ) {
        throw new AppError(
          "invalid_request",
          "Select one or more explicit Mail account sources before activation.",
        );
      }
      const profile = (
        await db
          .select()
          .from(domainProfiles)
          .where(
            and(
              eq(domainProfiles.id, existing.profileId),
              eq(domainProfiles.userId, context.principal.userId),
              eq(domainProfiles.domain, "mail"),
            ),
          )
          .limit(1)
      )[0];
      if (!profile) throw new AppError("not_found", "The mail profile was not found.");
      if (profile.status !== "active") {
        throw new AppError(
          "invalid_request",
          "Activate the linked Mail profile before activating this rule.",
        );
      }
      const profileSourceIds = new Set(profile.sourceContexts.map((source) => source.sourceId));
      if (existing.sourceAccountIds.some((sourceId) => !profileSourceIds.has(sourceId))) {
        throw new AppError(
          "invalid_request",
          "Every rule source must have an explicit meaning in the linked Mail profile.",
        );
      }
      const executableSources = await db
        .select({ id: calendarAccounts.id, provider: calendarAccounts.provider })
        .from(calendarAccounts)
        .where(
          and(
            eq(calendarAccounts.userId, context.principal.userId),
            eq(calendarAccounts.mailEnabled, true),
            inArray(calendarAccounts.id, existing.sourceAccountIds),
          ),
        );
      if (
        executableSources.length !== existing.sourceAccountIds.length ||
        executableSources.some((source) => source.provider !== "google")
      ) {
        throw new AppError(
          "invalid_request",
          "Automatic Mail rules currently require explicit Google Mail sources.",
        );
      }
      const parsedPreferences = mailProfilePreferencesSchema.safeParse(profile.preferences);
      if (!parsedPreferences.success) {
        throw new AppError(
          "invalid_request",
          "Review and save valid Mail retention preferences before activating this rule.",
        );
      }
      if (!mailRuleActionsMatchRetentionPreferences(resolved.actions, parsedPreferences.data)) {
        throw new AppError(
          "invalid_request",
          "The active Mail profile does not authorize this retention action and timing.",
        );
      }
      const updated = await db.transaction(async (transaction) => {
        const lockedSources = await transaction
          .select({
            id: calendarAccounts.id,
            mailEnabled: calendarAccounts.mailEnabled,
            provider: calendarAccounts.provider,
          })
          .from(calendarAccounts)
          .where(
            and(
              eq(calendarAccounts.userId, context.principal.userId),
              inArray(calendarAccounts.id, existing.sourceAccountIds),
            ),
          )
          .orderBy(asc(calendarAccounts.id))
          .for("share");
        if (
          lockedSources.length !== existing.sourceAccountIds.length ||
          lockedSources.some((source) => !source.mailEnabled || source.provider !== "google")
        ) {
          throw new AppError(
            "conflict",
            "A Mail source changed while the rule was being activated. Review the current setup before retrying.",
          );
        }
        const [lockedProfile] = await transaction
          .select()
          .from(domainProfiles)
          .where(
            and(
              eq(domainProfiles.id, profile.id),
              eq(domainProfiles.userId, context.principal.userId),
              eq(domainProfiles.domain, "mail"),
            ),
          )
          .for("share")
          .limit(1);
        if (lockedProfile?.status !== "active" || lockedProfile.version !== profile.version) {
          throw new AppError(
            "conflict",
            "The Mail profile changed while the rule was being activated. Review the current setup before retrying.",
          );
        }
        if (
          existing.sourceAccountIds.some(
            (sourceId) =>
              !lockedProfile.sourceContexts.some(
                (sourceContext) => sourceContext.sourceId === sourceId,
              ),
          )
        ) {
          throw new AppError(
            "conflict",
            "A rule source no longer has an explicit meaning in the Mail profile.",
          );
        }
        const lockedPreferences = mailProfilePreferencesSchema.safeParse(lockedProfile.preferences);
        if (!lockedPreferences.success) {
          throw new AppError(
            "conflict",
            "The Mail profile retention preferences changed and require review.",
          );
        }
        const [lockedRule] = await transaction
          .select()
          .from(mailRules)
          .where(
            and(
              eq(mailRules.id, id),
              eq(mailRules.userId, context.principal.userId),
              eq(mailRules.version, existing.version),
            ),
          )
          .for("update")
          .limit(1);
        if (!lockedRule) {
          throw new AppError("conflict", "The mail rule changed while it was being activated.");
        }
        const lockedResolved = resolveStoredMailRule({
          action: lockedRule.legacyAction,
          actions: lockedRule.actions,
          condition: lockedRule.condition,
          enabled: lockedRule.enabled,
          policy: lockedRule.policy,
          query: lockedRule.legacyQuery,
        });
        if (
          !mailRuleActionsMatchRetentionPreferences(lockedResolved.actions, lockedPreferences.data)
        ) {
          throw new AppError(
            "conflict",
            "The Mail profile no longer authorizes this delayed retention action and number of days.",
          );
        }
        if (lockedRule.enabled) {
          throw new AppError("conflict", "The mail rule changed while it was being activated.");
        }
        const labelIds = lockedResolved.actions.flatMap((action) =>
          action.type === "add_label" && action.mailboxId ? [action.mailboxId] : [],
        );
        if (labelIds.length > 0) {
          const destinations = await transaction
            .select({ accountId: mailboxes.accountId, id: mailboxes.id, role: mailboxes.role })
            .from(mailboxes)
            .where(
              and(
                eq(mailboxes.userId, context.principal.userId),
                isNull(mailboxes.deletedAt),
                inArray(mailboxes.id, labelIds),
              ),
            )
            .orderBy(asc(mailboxes.id))
            .for("share");
          if (
            destinations.length !== new Set(labelIds).size ||
            destinations.some((destination) => destination.role !== "custom") ||
            existing.sourceAccountIds.length !== 1 ||
            destinations.some(
              (destination) => destination.accountId !== existing.sourceAccountIds[0],
            )
          ) {
            throw new AppError(
              "conflict",
              "A Mail label destination changed while the rule was being activated. Review the current rule before retrying.",
            );
          }
        }
        const preview = await buildRulePreview(
          context.principal.userId,
          storedRulePreviewInput(lockedRule),
          lockedRule,
          transaction,
          true,
        );
        const expectedIds = [...new Set(input.expectedCandidateIds)].sort();
        const currentIds = preview.candidates.map((candidate) => candidate.id).sort();
        if (
          !fingerprintsMatch(
            previewFingerprint(preview, input.expectedPreviewedAt),
            input.expectedPreviewFingerprint,
          ) ||
          expectedIds.length !== input.expectedCandidateIds.length ||
          expectedIds.length !== currentIds.length ||
          expectedIds.some((candidateId, index) => candidateId !== currentIds[index])
        ) {
          throw new AppError(
            "conflict",
            "The exact Mail rule preview changed. Review the current candidates before activation.",
            { currentPreviewFingerprint: preview.fingerprint, currentVersion: existing.version },
          );
        }
        const [rule] = await transaction
          .update(mailRules)
          .set({
            enabled: true,
            policy: "approved_rule",
            updatedAt: now(),
            version: existing.version + 1,
          })
          .where(and(eq(mailRules.id, id), eq(mailRules.version, existing.version)))
          .returning();
        if (!rule) {
          throw new AppError("conflict", "The mail rule changed while it was being activated.");
        }
        if (currentIds.length > 0) {
          const candidateThreads = await transaction
            .select()
            .from(mailThreads)
            .where(
              and(
                eq(mailThreads.userId, context.principal.userId),
                isNull(mailThreads.deletedAt),
                inArray(mailThreads.id, currentIds),
              ),
            )
            .orderBy(asc(mailThreads.id))
            .for("share");
          await enqueueDurableMailRuleWork(transaction, {
            actions: lockedResolved.actions,
            profileId: lockedProfile.id,
            profileVersion: lockedProfile.version,
            ruleId: rule.id,
            ruleVersion: rule.version,
            threads: candidateThreads,
            userId: context.principal.userId,
          });
        }
        await transaction.insert(auditEvents).values(
          auditValues({
            action: "mail.rule.activated",
            after: auditMailRuleMetadata(rule, mailRuleChangedFields(lockedRule, rule)),
            before: auditMailRuleMetadata(lockedRule, mailRuleChangedFields(lockedRule, rule)),
            entityId: rule.id,
            entityType: "mail_rule",
            ...context,
          }),
        );
        return { preview, rule };
      });
      return { preview: updated.preview, rule: serializeMailRule(updated.rule) };
    },

    async updateRule(
      id: string,
      input: MailRuleUpdateRequest,
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
      if (input.policy !== undefined && input.policy !== "preview") {
        throw new AppError(
          "invalid_request",
          "Mail rules remain in preview policy until a fresh signed-in review promotes them to approved_rule.",
        );
      }
      if (input.enabled === true) {
        throw new AppError(
          "invalid_request",
          "Only a fresh signed-in review can activate a Mail rule.",
        );
      }
      const changesMatchingBehavior =
        input.actions !== undefined ||
        input.condition !== undefined ||
        input.confidenceThreshold !== undefined ||
        input.profileId !== undefined ||
        input.sourceIds !== undefined;
      if (
        existing.enabled &&
        resolvedExisting.policy === "approved_rule" &&
        changesMatchingBehavior
      ) {
        throw new AppError(
          "invalid_request",
          "Pause the active mail rule before changing its matching behavior.",
        );
      }
      const demoteApproval =
        resolvedExisting.policy === "approved_rule" &&
        (input.enabled === false || changesMatchingBehavior);
      const nextReferences = {
        actions: input.actions ?? resolvedExisting.actions,
        profileId: input.profileId === undefined ? existing.profileId : input.profileId,
        sourceIds: input.sourceIds ?? existing.sourceAccountIds,
      };
      const {
        confidenceThreshold,
        expectedVersion: _expectedVersion,
        sourceIds,
        ...changes
      } = input;
      const updatedAt = now();
      const updated = await db.transaction(async (transaction) => {
        await validateRuleReferences(transaction, context.principal.userId, nextReferences, true);
        const [lockedExisting] = await transaction
          .select()
          .from(mailRules)
          .where(
            and(
              eq(mailRules.id, id),
              eq(mailRules.userId, context.principal.userId),
              eq(mailRules.version, existing.version),
            ),
          )
          .for("update")
          .limit(1);
        if (!lockedExisting) {
          throw new AppError("conflict", "The mail rule changed while it was being saved.");
        }
        const [rule] = await transaction
          .update(mailRules)
          .set({
            ...changes,
            ...(demoteApproval ? { policy: "preview" as const } : {}),
            ...(confidenceThreshold === undefined
              ? {}
              : {
                  confidenceThreshold: null,
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
            after: auditMailRuleMetadata(rule, mailRuleChangedFields(lockedExisting, rule)),
            before: auditMailRuleMetadata(
              lockedExisting,
              mailRuleChangedFields(lockedExisting, rule),
            ),
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
      const activeSnooze = sql`exists (
        select 1 from ${mailSnoozes}
        where ${mailSnoozes.threadId} = ${mailThreads.id}
          and ${mailSnoozes.until} > ${now()}
      )`;
      conditions.push(query.snoozed ? activeSnooze : sql`not ${activeSnooze}`);
      if (query.accountIds?.length)
        conditions.push(inArray(mailThreads.accountId, query.accountIds));
      if (query.starred !== undefined) conditions.push(eq(mailThreads.starred, query.starred));
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

    async bulkUpdateThreads(
      input: BulkUpdateMailInput,
      context: MutationContext,
    ): Promise<BulkUpdateMailResult> {
      const settled: PromiseSettledResult<MailThread>[] = new Array(input.items.length);
      const currentMailboxIds = await mailboxMap(context.principal.userId);
      let nextIndex = 0;
      const worker = async () => {
        while (nextIndex < input.items.length) {
          const index = nextIndex++;
          const item = input.items[index] as (typeof input.items)[number];
          try {
            settled[index] = {
              status: "fulfilled",
              value: await applyThreadUpdate(
                context.principal.userId,
                item.id,
                {
                  expectedUpdatedAt: item.expectedUpdatedAt,
                  starred: input.starred,
                  unread: input.unread,
                },
                context.principal,
                context.requestId,
                currentMailboxIds,
              ),
            };
          } catch (error) {
            settled[index] = { reason: error, status: "rejected" };
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(2, input.items.length) }, () => worker()));
      const updatedIds = input.items.flatMap((item, index) =>
        settled[index]?.status === "fulfilled" ? [item.id] : [],
      );
      const failures = input.items.flatMap((item, index) => {
        const outcome = settled[index];
        if (outcome?.status !== "rejected") return [];
        const error = outcome.reason;
        return [
          {
            error:
              error instanceof AppError
                ? {
                    code: error.code,
                    details: error.details ?? null,
                    message: error.message,
                    status: error.status,
                  }
                : {
                    code: "service_unavailable",
                    details: null,
                    message: "The provider Mail update failed.",
                    status: 503,
                  },
            id: item.id,
          },
        ];
      });
      return {
        failedCount: failures.length,
        failures,
        updatedCount: updatedIds.length,
        updatedIds,
      };
    },

    async updateThread(
      userId: string,
      id: string,
      input: UpdateMailThreadInput,
      principal: { actorId: string; actorType: "agent" | "user" },
      requestId: string,
    ): Promise<MailThread> {
      return applyThreadUpdate(userId, id, input, principal, requestId);
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
    confidenceThreshold: null,
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

function serializeLegacyMailDraft(row: typeof mailDrafts.$inferSelect): LegacyMailDraft {
  return {
    accountId: row.accountId,
    body: row.body,
    cc: row.cc.map((recipient) => recipient.address),
    createdAt: row.createdAt.toISOString(),
    deliveryState:
      row.sentAt !== null || row.sendStatus === "sent"
        ? "sent"
        : row.sendStatus === "draft"
          ? "unsent"
          : "delivery_unknown",
    id: row.id,
    subject: row.subject,
    threadId: row.threadId,
    to: row.to.map((recipient) => recipient.address),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeMailAttentionItem(row: typeof attentionItems.$inferSelect): AttentionItem {
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
    version: row.version,
  };
}
