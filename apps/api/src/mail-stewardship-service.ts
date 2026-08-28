import { createHash } from "node:crypto";
import {
  auditEvents,
  calendarAccounts,
  type Database,
  domainProfileApprovals,
  domainProfiles,
  mailMessages,
  mailObligations,
  mailReviews,
  mailRuleProposals,
  mailRules,
  mailRuleWorkItems,
  mailSnoozes,
  mailStewardshipFeedback,
  mailStewardshipQuestions,
  mailThreadDispositions,
  mailThreads,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import type {
  AnswerMailQuestionInput,
  CreateMailObligationInput,
  CreateMailStewardshipFeedbackInput,
  MailDisposition,
  MailObligation,
  MailResponseBrief,
  MailReview,
  MailRuleProposal,
  MailStatus,
  MailStewardshipFeedback,
  MailStewardshipQuestion,
  MailThreadStewardship,
  MaintenanceScope,
  PreviewMailResponseBriefInput,
  SetMailDispositionInput,
  UpdateMailObligationInput,
} from "@personal-os/domain";
import { mailDispositionKindSchema, mailStatusSchema } from "@personal-os/domain";
import { and, asc, desc, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { auditValues } from "./audit.js";
import { requireDatabaseRecord } from "./database.js";
import { AppError } from "./errors.js";
import { assessMail, type MailAssessment, type MailAssessmentSnapshot } from "./mail-assessment.js";
import { MAIL_PLAYBOOK } from "./mail-playbook.js";
import type { Principal } from "./types.js";

type MutationContext = { principal: Principal; requestId: string };
type Options = { db: Database; now: () => Date };

function serializeObligation(row: typeof mailObligations.$inferSelect): MailObligation {
  return {
    closureEvidence: row.closureEvidence,
    confidence: row.confidence,
    createdAt: row.createdAt.toISOString(),
    dueAt: row.dueAt?.toISOString() ?? null,
    goalIds: row.goalIds,
    id: row.id,
    kind: row.kind,
    nextReviewAt: row.nextReviewAt?.toISOString() ?? null,
    owner: row.owner,
    rationale: row.rationale,
    sourceMessageId: row.sourceMessageId,
    sourceThreadRevision: row.sourceThreadRevision.toISOString(),
    state: row.state,
    threadId: row.threadId,
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

function serializeDisposition(row: typeof mailThreadDispositions.$inferSelect): MailDisposition {
  return {
    createdAt: row.createdAt.toISOString(),
    current: row.current,
    disposition: row.disposition,
    id: row.id,
    rationale: row.rationale,
    sourceThreadRevision: row.sourceThreadRevision.toISOString(),
    threadId: row.threadId,
    version: row.version,
  };
}

function serializeQuestion(
  row: typeof mailStewardshipQuestions.$inferSelect,
): MailStewardshipQuestion {
  return {
    accountId: row.accountId,
    answer: row.answer,
    answeredAt: row.answeredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    evidence: row.evidence,
    fingerprint: row.fingerprint,
    id: row.id,
    kind: row.kind,
    options: row.options,
    reason: row.reason,
    status: row.status,
    threadId: row.threadId,
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

function serializeProposal(row: typeof mailRuleProposals.$inferSelect): MailRuleProposal {
  return {
    approvedRuleId: row.approvedRuleId,
    counterexamples: row.counterexamples,
    createdAt: row.createdAt.toISOString(),
    examples: row.examples,
    exceptions: row.exceptions,
    id: row.id,
    rationale: row.rationale,
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  };
}

function serializeFeedback(
  row: typeof mailStewardshipFeedback.$inferSelect,
): MailStewardshipFeedback {
  return {
    comment: row.comment,
    createdAt: row.createdAt.toISOString(),
    evidence: row.evidence,
    id: row.id,
    kind: row.kind,
    targetId: row.targetId,
    targetType: row.targetType,
  };
}

function serializeReview(row: typeof mailReviews.$inferSelect): MailReview {
  return {
    createdAt: row.createdAt.toISOString(),
    effectCounts: row.effectCounts,
    evidenceCutoff: row.evidenceCutoff.toISOString(),
    health: row.health,
    id: row.id,
    ledgerFingerprint: row.ledgerFingerprint,
    nextMaintenanceAt: row.nextMaintenanceAt.toISOString(),
    obligationCounts: row.obligationCounts,
    openQuestionCount: row.openQuestionCount,
    playbookVersion: row.playbookVersion,
    profileVersion: row.profileVersion,
    rulebookVersion: row.rulebookVersion,
    sourceFreshness: row.sourceFreshness,
    state: row.state,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function groupRows<Row, Key>(rows: Row[], keyFor: (row: Row) => Key): Map<Key, Row[]> {
  const grouped = new Map<Key, Row[]>();
  for (const row of rows) {
    const key = keyFor(row);
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return grouped;
}

function auditSnapshot(value: { id: string; threadId: string; version: number }) {
  return { id: value.id, threadId: value.threadId, version: value.version };
}

function assertCurrentRevision(actual: Date, expected: string) {
  if (actual.getTime() !== new Date(expected).getTime()) {
    throw new AppError(
      "conflict",
      "The mail thread changed after this judgment was prepared. Refresh and review it again.",
      { currentThreadUpdatedAt: actual.toISOString() },
    );
  }
}

export function createMailStewardshipService({ db, now }: Options) {
  function assertContextOwner(userId: string, context: MutationContext) {
    if (userId !== context.principal.userId) {
      throw new AppError("not_found", "The mail stewardship record was not found.");
    }
  }

  async function findOwnedThread(threadId: string, userId: string) {
    const [thread] = await db
      .select()
      .from(mailThreads)
      .where(
        and(
          eq(mailThreads.id, threadId),
          eq(mailThreads.userId, userId),
          isNull(mailThreads.deletedAt),
        ),
      );
    if (!thread) throw new AppError("not_found", "The mail thread was not found.");
    return thread;
  }

  async function readSnapshot(
    userId: string,
    scope: MaintenanceScope,
  ): Promise<MailAssessmentSnapshot> {
    return db.transaction(
      async (tx) => {
        const asOf = now();
        const accounts = await tx
          .select()
          .from(calendarAccounts)
          .where(and(eq(calendarAccounts.userId, userId), eq(calendarAccounts.mailEnabled, true)));
        const freshnessCutoff =
          asOf.getTime() - MAIL_PLAYBOOK.freshness.currentWithinMinutes * 60_000;
        const currentAccountIds = new Set(
          accounts
            .filter(
              (account) =>
                account.syncStatus === "idle" &&
                account.lastSyncedAt !== null &&
                account.lastSyncedAt.getTime() >= freshnessCutoff,
            )
            .map((account) => account.id),
        );
        const sourceFreshness: MailAssessmentSnapshot["sourceFreshness"] =
          accounts.length === 0
            ? "unavailable"
            : currentAccountIds.size === accounts.length
              ? "current"
              : currentAccountIds.size > 0
                ? "partial"
                : accounts.some((account) => account.lastSyncedAt !== null)
                  ? "stale"
                  : "unavailable";

        const threadConditions = [eq(mailThreads.userId, userId), isNull(mailThreads.deletedAt)];
        if (scope.type === "target") {
          if (scope.entityType !== "mail_thread") {
            throw new AppError(
              "invalid_request",
              "Mail maintenance targets must identify a mail_thread.",
            );
          }
          threadConditions.push(eq(mailThreads.id, scope.id));
        } else if (scope.type === "window") {
          threadConditions.push(
            gte(mailThreads.receivedAt, new Date(`${scope.start}T00:00:00.000Z`)),
          );
          threadConditions.push(
            lte(mailThreads.receivedAt, new Date(`${scope.end}T23:59:59.999Z`)),
          );
        }
        const threads = await tx
          .select()
          .from(mailThreads)
          .where(and(...threadConditions))
          .orderBy(asc(mailThreads.id));
        const threadIds = threads.map((thread) => thread.id);
        const [approval] = await tx
          .select({
            profileId: domainProfileApprovals.profileId,
            profileVersion: domainProfileApprovals.profileVersion,
          })
          .from(domainProfileApprovals)
          .innerJoin(
            domainProfiles,
            and(
              eq(domainProfiles.id, domainProfileApprovals.profileId),
              eq(domainProfiles.userId, userId),
              eq(domainProfiles.domain, "mail"),
              eq(domainProfiles.status, "active"),
            ),
          )
          .where(
            and(
              eq(domainProfileApprovals.userId, userId),
              eq(domainProfileApprovals.domain, "mail"),
            ),
          );
        const rules = await tx
          .select({ id: mailRules.id, version: mailRules.version })
          .from(mailRules)
          .where(and(eq(mailRules.userId, userId), eq(mailRules.enabled, true)))
          .orderBy(asc(mailRules.id));
        const rulebookVersion = sha256(JSON.stringify(rules));

        if (threadIds.length === 0) {
          return {
            effectCounts: { failed: 0, pending: 0, reconcile: 0 },
            now: asOf.toISOString(),
            profileId: approval?.profileId ?? null,
            profileVersion: approval?.profileVersion ?? null,
            rulebookVersion,
            sourceFreshness,
            threads: [],
          };
        }
        const obligations = await tx
          .select()
          .from(mailObligations)
          .where(
            and(eq(mailObligations.userId, userId), inArray(mailObligations.threadId, threadIds)),
          );
        const dispositions = await tx
          .select()
          .from(mailThreadDispositions)
          .where(
            and(
              eq(mailThreadDispositions.userId, userId),
              inArray(mailThreadDispositions.threadId, threadIds),
              eq(mailThreadDispositions.current, true),
            ),
          );
        const messages = await tx
          .select()
          .from(mailMessages)
          .where(inArray(mailMessages.threadId, threadIds));
        const snoozes = await tx
          .select()
          .from(mailSnoozes)
          .where(and(eq(mailSnoozes.userId, userId), inArray(mailSnoozes.threadId, threadIds)));
        const openQuestions = await tx
          .select()
          .from(mailStewardshipQuestions)
          .where(
            and(
              eq(mailStewardshipQuestions.userId, userId),
              inArray(mailStewardshipQuestions.threadId, threadIds),
              eq(mailStewardshipQuestions.status, "open"),
            ),
          );
        const workItems = await tx
          .select()
          .from(mailRuleWorkItems)
          .where(
            and(
              eq(mailRuleWorkItems.userId, userId),
              inArray(mailRuleWorkItems.threadId, threadIds),
            ),
          );
        const obligationByThread = groupRows(obligations, (row) => row.threadId);
        const messagesByThread = groupRows(messages, (row) => row.threadId);
        const questionsByThread = groupRows(openQuestions, (row) => row.threadId);
        const workByThread = groupRows(workItems, (row) => row.threadId ?? "");
        const dispositionByThread = new Map(dispositions.map((row) => [row.threadId, row]));
        const snoozeByThread = new Map(snoozes.map((row) => [row.threadId, row]));
        const effectCounts = workItems.reduce(
          (counts, item) => {
            if (item.status === "failed") counts.failed += 1;
            else if (item.status === "reconcile") counts.reconcile += 1;
            else if (item.status === "pending" || item.status === "claimed") counts.pending += 1;
            return counts;
          },
          { failed: 0, pending: 0, reconcile: 0 },
        );

        return {
          effectCounts,
          now: asOf.toISOString(),
          profileId: approval?.profileId ?? null,
          profileVersion: approval?.profileVersion ?? null,
          rulebookVersion,
          sourceFreshness,
          threads: threads.map((thread) => {
            const threadObligations = obligationByThread.get(thread.id) ?? [];
            const threadWork = workByThread.get(thread.id) ?? [];
            const disposition = dispositionByThread.get(thread.id);
            return {
              accountId: thread.accountId,
              approvedRuleMatched: threadWork.length > 0,
              approvedRuleMatches: threadWork.map((item) => ({
                ruleId: item.ruleId,
                ruleVersion: item.ruleVersion,
              })),
              attentionLinked: false,
              currentDisposition: disposition
                ? {
                    disposition: disposition.disposition,
                    sourceThreadRevision: disposition.sourceThreadRevision.toISOString(),
                  }
                : null,
              goalLinked: threadObligations.some((obligation) => obligation.goalIds.length > 0),
              id: thread.id,
              messages: (messagesByThread.get(thread.id) ?? []).map((message) => ({
                authority: "provider_projected" as const,
                direction: message.providerMailboxIds.some((mailboxId) =>
                  mailboxId.toLowerCase().includes("sent"),
                )
                  ? ("outbound" as const)
                  : ("inbound" as const),
                id: message.id,
                observedAt: message.receivedAt.toISOString(),
                revision: message.providerRevision,
              })),
              obligations: threadObligations.map((obligation) => ({
                id: obligation.id,
                kind: obligation.kind,
                sourceThreadRevision: obligation.sourceThreadRevision.toISOString(),
                state: obligation.state,
                version: obligation.version,
              })),
              openQuestions: (questionsByThread.get(thread.id) ?? []).map((question) => ({
                fingerprint: question.fingerprint,
                id: question.id,
                version: question.version,
              })),
              snoozedUntil: snoozeByThread.get(thread.id)?.until.toISOString() ?? null,
              source: {
                accountId: thread.accountId,
                provider: thread.provider,
                remoteId: thread.remoteThreadId,
                revision: thread.updatedAt.toISOString(),
                sourceType: "mail_thread" as const,
              },
              starred: thread.starred,
              updatedAt: thread.updatedAt.toISOString(),
            };
          }),
        };
      },
      { accessMode: "read only", isolationLevel: "repeatable read" },
    );
  }

  return {
    async getThreadStewardship(userId: string, threadId: string): Promise<MailThreadStewardship> {
      const thread = await findOwnedThread(threadId, userId);
      const [obligations, dispositions, questions] = await Promise.all([
        db
          .select()
          .from(mailObligations)
          .where(and(eq(mailObligations.threadId, thread.id), eq(mailObligations.userId, userId)))
          .orderBy(asc(mailObligations.createdAt)),
        db
          .select()
          .from(mailThreadDispositions)
          .where(
            and(
              eq(mailThreadDispositions.threadId, thread.id),
              eq(mailThreadDispositions.userId, userId),
              eq(mailThreadDispositions.current, true),
            ),
          ),
        db
          .select()
          .from(mailStewardshipQuestions)
          .where(
            and(
              eq(mailStewardshipQuestions.threadId, thread.id),
              eq(mailStewardshipQuestions.userId, userId),
              eq(mailStewardshipQuestions.status, "open"),
            ),
          )
          .orderBy(asc(mailStewardshipQuestions.createdAt)),
      ]);
      return {
        disposition: dispositions[0] ? serializeDisposition(dispositions[0]) : null,
        obligations: obligations.map(serializeObligation),
        questions: questions.map(serializeQuestion),
        threadId: thread.id,
        threadUpdatedAt: thread.updatedAt.toISOString(),
      };
    },

    async createObligation(
      userId: string,
      threadId: string,
      input: CreateMailObligationInput,
      context: MutationContext,
    ): Promise<MailObligation> {
      assertContextOwner(userId, context);
      const created = await db.transaction(async (tx) => {
        const [thread] = await tx
          .select()
          .from(mailThreads)
          .where(and(eq(mailThreads.id, threadId), eq(mailThreads.userId, userId)))
          .for("update");
        if (!thread || thread.deletedAt) {
          throw new AppError("not_found", "The mail thread was not found.");
        }
        assertCurrentRevision(thread.updatedAt, input.sourceThreadRevision);
        if (input.sourceMessageId) {
          const [message] = await tx
            .select({ id: mailMessages.id })
            .from(mailMessages)
            .where(
              and(eq(mailMessages.id, input.sourceMessageId), eq(mailMessages.threadId, thread.id)),
            );
          if (!message) {
            throw new AppError(
              "invalid_request",
              "The source message does not belong to the thread.",
            );
          }
        }
        const row = requireDatabaseRecord(
          (
            await tx
              .insert(mailObligations)
              .values({
                ...input,
                createdAt: now(),
                dueAt: input.dueAt ? new Date(input.dueAt) : null,
                nextReviewAt: input.nextReviewAt ? new Date(input.nextReviewAt) : null,
                sourceThreadRevision: new Date(input.sourceThreadRevision),
                threadId: thread.id,
                updatedAt: now(),
                userId,
              })
              .returning()
          )[0],
          "The obligation could not be created.",
        );
        await tx.insert(auditEvents).values(
          auditValues({
            action: "mail_obligation.created",
            after: auditSnapshot(row),
            before: null,
            entityId: row.id,
            entityType: "mail_obligation",
            ...context,
          }),
        );
        return row;
      });
      return serializeObligation(created);
    },

    async updateObligation(
      userId: string,
      id: string,
      input: UpdateMailObligationInput,
      context: MutationContext,
    ): Promise<MailObligation> {
      assertContextOwner(userId, context);
      const updated = await db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(mailObligations)
          .where(and(eq(mailObligations.id, id), eq(mailObligations.userId, userId)))
          .for("update");
        if (!before) throw new AppError("not_found", "The mail obligation was not found.");
        if (before.version !== input.expectedVersion) {
          throw new AppError("conflict", "The mail obligation changed. Refresh and try again.", {
            currentVersion: before.version,
          });
        }
        const { dueAt, expectedVersion: _expectedVersion, nextReviewAt, ...changes } = input;
        const row = requireDatabaseRecord(
          (
            await tx
              .update(mailObligations)
              .set({
                ...changes,
                ...(dueAt === undefined ? {} : { dueAt: dueAt ? new Date(dueAt) : null }),
                ...(nextReviewAt === undefined
                  ? {}
                  : { nextReviewAt: nextReviewAt ? new Date(nextReviewAt) : null }),
                updatedAt: now(),
                version: before.version + 1,
              })
              .where(eq(mailObligations.id, before.id))
              .returning()
          )[0],
          "The obligation could not be updated.",
        );
        await tx.insert(auditEvents).values(
          auditValues({
            action: "mail_obligation.updated",
            after: auditSnapshot(row),
            before: auditSnapshot(before),
            entityId: row.id,
            entityType: "mail_obligation",
            ...context,
          }),
        );
        return row;
      });
      return serializeObligation(updated);
    },

    async setDisposition(
      userId: string,
      threadId: string,
      input: SetMailDispositionInput,
      context: MutationContext,
    ): Promise<MailDisposition> {
      assertContextOwner(userId, context);
      const created = await db.transaction(async (tx) => {
        const [thread] = await tx
          .select()
          .from(mailThreads)
          .where(and(eq(mailThreads.id, threadId), eq(mailThreads.userId, userId)))
          .for("update");
        if (!thread || thread.deletedAt) {
          throw new AppError("not_found", "The mail thread was not found.");
        }
        assertCurrentRevision(thread.updatedAt, input.expectedThreadUpdatedAt);
        const [before] = await tx
          .select()
          .from(mailThreadDispositions)
          .where(
            and(
              eq(mailThreadDispositions.threadId, thread.id),
              eq(mailThreadDispositions.userId, userId),
              eq(mailThreadDispositions.current, true),
            ),
          )
          .for("update");
        if (before) {
          await tx
            .update(mailThreadDispositions)
            .set({ current: false })
            .where(eq(mailThreadDispositions.id, before.id));
        }
        const row = requireDatabaseRecord(
          (
            await tx
              .insert(mailThreadDispositions)
              .values({
                createdAt: now(),
                disposition: input.disposition,
                rationale: input.rationale,
                sourceThreadRevision: new Date(input.expectedThreadUpdatedAt),
                threadId: thread.id,
                userId,
                version: (before?.version ?? 0) + 1,
              })
              .returning()
          )[0],
          "The disposition could not be recorded.",
        );
        await tx.insert(auditEvents).values(
          auditValues({
            action: "mail_disposition.set",
            after: auditSnapshot(row),
            before: before ? auditSnapshot(before) : null,
            entityId: row.id,
            entityType: "mail_disposition",
            ...context,
          }),
        );
        return row;
      });
      return serializeDisposition(created);
    },

    async listDispositionHistory(userId: string, threadId: string): Promise<MailDisposition[]> {
      const thread = await findOwnedThread(threadId, userId);
      return (
        await db
          .select()
          .from(mailThreadDispositions)
          .where(
            and(
              eq(mailThreadDispositions.threadId, thread.id),
              eq(mailThreadDispositions.userId, userId),
            ),
          )
          .orderBy(desc(mailThreadDispositions.version))
      ).map(serializeDisposition);
    },

    async answerQuestion(
      userId: string,
      id: string,
      input: AnswerMailQuestionInput,
      context: MutationContext,
    ): Promise<MailStewardshipQuestion> {
      assertContextOwner(userId, context);
      const answered = await db.transaction(async (tx) => {
        const [before] = await tx
          .select()
          .from(mailStewardshipQuestions)
          .where(
            and(eq(mailStewardshipQuestions.id, id), eq(mailStewardshipQuestions.userId, userId)),
          )
          .for("update");
        if (!before) throw new AppError("not_found", "The Mail question was not found.");
        if (before.version !== input.expectedVersion) {
          throw new AppError("conflict", "The Mail question changed. Refresh and try again.", {
            currentVersion: before.version,
          });
        }
        if (before.status !== "open") {
          throw new AppError("conflict", "The Mail question has already been settled.");
        }
        const row = requireDatabaseRecord(
          (
            await tx
              .update(mailStewardshipQuestions)
              .set({
                answer: input.answer,
                answeredAt: now(),
                status: "answered",
                updatedAt: now(),
                version: before.version + 1,
              })
              .where(eq(mailStewardshipQuestions.id, before.id))
              .returning()
          )[0],
          "The Mail question could not be answered.",
        );
        await tx.insert(auditEvents).values(
          auditValues({
            action: "mail_question.answered",
            after: auditSnapshot(row),
            before: auditSnapshot(before),
            entityId: row.id,
            entityType: "mail_question",
            ...context,
          }),
        );
        const selectedDisposition = mailDispositionKindSchema.safeParse(input.answer);
        if (before.kind === "needs_disposition" && selectedDisposition.success) {
          const [thread] = await tx
            .select()
            .from(mailThreads)
            .where(and(eq(mailThreads.id, before.threadId), eq(mailThreads.userId, userId)))
            .for("update");
          if (!thread) throw new AppError("not_found", "The Mail thread was not found.");
          const [current] = await tx
            .select()
            .from(mailThreadDispositions)
            .where(
              and(
                eq(mailThreadDispositions.threadId, thread.id),
                eq(mailThreadDispositions.userId, userId),
                eq(mailThreadDispositions.current, true),
              ),
            )
            .for("update");
          if (current) {
            await tx
              .update(mailThreadDispositions)
              .set({ current: false })
              .where(eq(mailThreadDispositions.id, current.id));
          }
          const disposition = requireDatabaseRecord(
            (
              await tx
                .insert(mailThreadDispositions)
                .values({
                  createdAt: now(),
                  disposition: selectedDisposition.data,
                  rationale: "Recorded from an explicit Mail stewardship answer.",
                  sourceThreadRevision: thread.updatedAt,
                  threadId: thread.id,
                  userId,
                  version: (current?.version ?? 0) + 1,
                })
                .returning()
            )[0],
            "The answered disposition could not be recorded.",
          );
          await tx.insert(auditEvents).values(
            auditValues({
              action: "mail_disposition.answered",
              after: auditSnapshot(disposition),
              before: current ? auditSnapshot(current) : null,
              entityId: disposition.id,
              entityType: "mail_disposition",
              ...context,
            }),
          );
        }
        if (input.generalize) {
          const proposal = requireDatabaseRecord(
            (
              await tx
                .insert(mailRuleProposals)
                .values({
                  counterexamples: [],
                  createdAt: now(),
                  examples: [`question:${before.id}`],
                  exceptions: [],
                  fingerprint: sha256(
                    JSON.stringify({
                      answer: input.answer,
                      questionId: before.id,
                      version: row.version,
                    }),
                  ),
                  rationale: input.answer,
                  updatedAt: now(),
                  userId,
                })
                .returning()
            )[0],
            "The Mail rule proposal could not be created.",
          );
          await tx.insert(auditEvents).values(
            auditValues({
              action: "mail_rule_proposal.created",
              after: { id: proposal.id, version: proposal.version },
              before: null,
              entityId: proposal.id,
              entityType: "mail_rule_proposal",
              ...context,
            }),
          );
        }
        return row;
      });
      return serializeQuestion(answered);
    },

    async listRuleProposals(userId: string): Promise<MailRuleProposal[]> {
      return (
        await db
          .select()
          .from(mailRuleProposals)
          .where(eq(mailRuleProposals.userId, userId))
          .orderBy(asc(mailRuleProposals.createdAt))
      ).map(serializeProposal);
    },

    async previewResponseBrief(
      userId: string,
      threadId: string,
      input: PreviewMailResponseBriefInput,
    ): Promise<MailResponseBrief> {
      const thread = await findOwnedThread(threadId, userId);
      assertCurrentRevision(thread.updatedAt, input.expectedThreadUpdatedAt);
      const { expectedThreadUpdatedAt: _expectedThreadUpdatedAt, ...guidance } = input;
      return {
        ...guidance,
        evidence: [
          {
            accountId: thread.accountId,
            provider: thread.provider,
            remoteId: thread.remoteThreadId,
            revision: thread.updatedAt.toISOString(),
            sourceType: "mail_thread",
          },
        ],
        sourceThreadRevision: thread.updatedAt.toISOString(),
        transmittable: false,
      };
    },

    async createFeedback(
      userId: string,
      input: CreateMailStewardshipFeedbackInput,
      context: MutationContext,
    ): Promise<MailStewardshipFeedback> {
      assertContextOwner(userId, context);
      const created = await db.transaction(async (tx) => {
        let targetThreadId: string | null = null;
        if (input.targetType === "obligation") {
          const [target] = await tx
            .select({ threadId: mailObligations.threadId, version: mailObligations.version })
            .from(mailObligations)
            .where(and(eq(mailObligations.id, input.targetId), eq(mailObligations.userId, userId)))
            .for("update");
          if (!target) throw new AppError("not_found", "The Mail feedback target was not found.");
          targetThreadId = target.threadId;
          if (input.kind === "incorrect") {
            const updated = requireDatabaseRecord(
              (
                await tx
                  .update(mailObligations)
                  .set({ state: "open", updatedAt: now(), version: target.version + 1 })
                  .where(eq(mailObligations.id, input.targetId))
                  .returning()
              )[0],
              "The Mail obligation could not be reopened.",
            );
            await tx.insert(auditEvents).values(
              auditValues({
                action: "mail_obligation.reopened_from_feedback",
                after: auditSnapshot(updated),
                before: { id: input.targetId, threadId: target.threadId, version: target.version },
                entityId: updated.id,
                entityType: "mail_obligation",
                ...context,
              }),
            );
          }
        } else if (input.targetType === "disposition") {
          const [target] = await tx
            .select({ threadId: mailThreadDispositions.threadId })
            .from(mailThreadDispositions)
            .where(
              and(
                eq(mailThreadDispositions.id, input.targetId),
                eq(mailThreadDispositions.userId, userId),
              ),
            );
          if (!target) throw new AppError("not_found", "The Mail feedback target was not found.");
          targetThreadId = target.threadId;
        } else if (input.targetType === "question") {
          const [target] = await tx
            .select({ threadId: mailStewardshipQuestions.threadId })
            .from(mailStewardshipQuestions)
            .where(
              and(
                eq(mailStewardshipQuestions.id, input.targetId),
                eq(mailStewardshipQuestions.userId, userId),
              ),
            );
          if (!target) throw new AppError("not_found", "The Mail feedback target was not found.");
          targetThreadId = target.threadId;
        } else if (input.targetType === "rule_proposal") {
          const [target] = await tx
            .select()
            .from(mailRuleProposals)
            .where(
              and(eq(mailRuleProposals.id, input.targetId), eq(mailRuleProposals.userId, userId)),
            )
            .for("update");
          if (!target) throw new AppError("not_found", "The Mail feedback target was not found.");
          if (input.kind === "exception") {
            const updated = requireDatabaseRecord(
              (
                await tx
                  .update(mailRuleProposals)
                  .set({
                    counterexamples: [...target.counterexamples, input.comment],
                    exceptions: [...target.exceptions, input.comment],
                    updatedAt: now(),
                    version: target.version + 1,
                  })
                  .where(eq(mailRuleProposals.id, target.id))
                  .returning()
              )[0],
              "The Mail rule proposal could not be updated.",
            );
            await tx.insert(auditEvents).values(
              auditValues({
                action: "mail_rule_proposal.exception_added",
                after: { id: updated.id, version: updated.version },
                before: { id: target.id, version: target.version },
                entityId: updated.id,
                entityType: "mail_rule_proposal",
                ...context,
              }),
            );
          }
        } else {
          const [target] = await tx
            .select({ id: mailReviews.id })
            .from(mailReviews)
            .where(and(eq(mailReviews.id, input.targetId), eq(mailReviews.userId, userId)));
          if (!target) throw new AppError("not_found", "The Mail feedback target was not found.");
        }

        let evidence: MailStewardshipFeedback["evidence"] = [];
        if (targetThreadId) {
          const [thread] = await tx
            .select()
            .from(mailThreads)
            .where(and(eq(mailThreads.id, targetThreadId), eq(mailThreads.userId, userId)));
          if (thread) {
            evidence = [
              {
                accountId: thread.accountId,
                provider: thread.provider,
                remoteId: thread.remoteThreadId,
                revision: thread.updatedAt.toISOString(),
                sourceType: "mail_thread",
              },
            ];
          }
          if (
            (input.kind === "incorrect" ||
              input.kind === "outdated" ||
              input.kind === "exception") &&
            thread
          ) {
            const [question] = await tx
              .insert(mailStewardshipQuestions)
              .values({
                accountId: thread.accountId,
                createdAt: now(),
                evidence,
                fingerprint: sha256(
                  JSON.stringify({
                    feedbackKind: input.kind,
                    targetId: input.targetId,
                    targetType: input.targetType,
                  }),
                ),
                kind:
                  input.kind === "exception"
                    ? "needs_exception"
                    : input.kind === "outdated"
                      ? "needs_disposition"
                      : "needs_correction",
                options: [],
                reason: "Recorded feedback requires a bounded Mail stewardship correction.",
                threadId: thread.id,
                updatedAt: now(),
                userId,
              })
              .onConflictDoNothing()
              .returning();
            if (question) {
              await tx.insert(auditEvents).values(
                auditValues({
                  action: "mail_question.created_from_feedback",
                  after: auditSnapshot(question),
                  before: null,
                  entityId: question.id,
                  entityType: "mail_question",
                  ...context,
                }),
              );
            }
          }
        }
        const row = requireDatabaseRecord(
          (
            await tx
              .insert(mailStewardshipFeedback)
              .values({ ...input, createdAt: now(), evidence, userId })
              .returning()
          )[0],
          "Mail feedback could not be recorded.",
        );
        await tx.insert(auditEvents).values(
          auditValues({
            action: "mail_stewardship_feedback.created",
            after: { id: row.id, targetId: row.targetId },
            before: null,
            entityId: row.id,
            entityType: "mail_stewardship_feedback",
            ...context,
          }),
        );
        return row;
      });
      return serializeFeedback(created);
    },

    async snapshot(userId: string, scope: MaintenanceScope): Promise<MailAssessmentSnapshot> {
      return readSnapshot(userId, scope);
    },

    async reconcileAssessment(
      userId: string,
      snapshot: MailAssessmentSnapshot,
      assessment: MailAssessment,
    ): Promise<{ dispositions: number; obligations: number; questions: number }> {
      const recalculated = assessMail(snapshot, MAIL_PLAYBOOK);
      if (recalculated.ledgerFingerprint !== assessment.ledgerFingerprint) {
        throw new AppError("conflict", "The Mail assessment does not match its source snapshot.");
      }
      const context: MutationContext = {
        principal: {
          actorId: "mail-steward",
          actorType: "agent",
          scopes: new Set(),
          userId,
        },
        requestId: `mail-assessment:${assessment.ledgerFingerprint}`,
      };
      return db.transaction(async (tx) => {
        let obligationCount = 0;
        for (const transition of assessment.obligationTransitions) {
          const [before] = await tx
            .select()
            .from(mailObligations)
            .where(
              and(
                eq(mailObligations.id, transition.obligationId),
                eq(mailObligations.userId, userId),
              ),
            )
            .for("update");
          if (!before || before.version !== transition.expectedVersion) {
            throw new AppError(
              "conflict",
              "A Mail obligation changed while maintenance was reconciling it.",
            );
          }
          const updated = requireDatabaseRecord(
            (
              await tx
                .update(mailObligations)
                .set({
                  closureEvidence: transition.evidence,
                  state: transition.nextState,
                  updatedAt: now(),
                  version: before.version + 1,
                })
                .where(eq(mailObligations.id, before.id))
                .returning()
            )[0],
            "The Mail obligation could not be reconciled.",
          );
          await tx.insert(auditEvents).values(
            auditValues({
              action: "mail_obligation.reconciled",
              after: auditSnapshot(updated),
              before: auditSnapshot(before),
              entityId: updated.id,
              entityType: "mail_obligation",
              ...context,
            }),
          );
          obligationCount += 1;
        }

        let dispositionCount = 0;
        for (const transition of assessment.dispositionTransitions) {
          const [thread] = await tx
            .select()
            .from(mailThreads)
            .where(and(eq(mailThreads.id, transition.threadId), eq(mailThreads.userId, userId)))
            .for("update");
          if (!thread) throw new AppError("not_found", "The Mail thread was not found.");
          assertCurrentRevision(thread.updatedAt, transition.sourceThreadRevision);
          const [before] = await tx
            .select()
            .from(mailThreadDispositions)
            .where(
              and(
                eq(mailThreadDispositions.threadId, thread.id),
                eq(mailThreadDispositions.userId, userId),
                eq(mailThreadDispositions.current, true),
              ),
            )
            .for("update");
          if (before?.disposition === transition.disposition) continue;
          if (before) {
            await tx
              .update(mailThreadDispositions)
              .set({ current: false })
              .where(eq(mailThreadDispositions.id, before.id));
          }
          const created = requireDatabaseRecord(
            (
              await tx
                .insert(mailThreadDispositions)
                .values({
                  createdAt: now(),
                  disposition: transition.disposition,
                  rationale: "Derived from an active Ilo snooze.",
                  sourceThreadRevision: thread.updatedAt,
                  threadId: thread.id,
                  userId,
                  version: (before?.version ?? 0) + 1,
                })
                .returning()
            )[0],
            "The Mail disposition could not be reconciled.",
          );
          await tx.insert(auditEvents).values(
            auditValues({
              action: "mail_disposition.reconciled",
              after: auditSnapshot(created),
              before: before ? auditSnapshot(before) : null,
              entityId: created.id,
              entityType: "mail_disposition",
              ...context,
            }),
          );
          dispositionCount += 1;
        }

        let questionCount = 0;
        for (const question of assessment.questions) {
          const [created] = await tx
            .insert(mailStewardshipQuestions)
            .values({
              ...question,
              createdAt: now(),
              updatedAt: now(),
              userId,
            })
            .onConflictDoNothing()
            .returning();
          if (!created) continue;
          await tx.insert(auditEvents).values(
            auditValues({
              action: "mail_question.created",
              after: auditSnapshot(created),
              before: null,
              entityId: created.id,
              entityType: "mail_question",
              ...context,
            }),
          );
          questionCount += 1;
        }
        return {
          dispositions: dispositionCount,
          obligations: obligationCount,
          questions: questionCount,
        };
      });
    },

    async createReview(
      userId: string,
      snapshot: MailAssessmentSnapshot,
      assessment: MailAssessment,
    ): Promise<MailReview> {
      const recalculated = assessMail(snapshot, MAIL_PLAYBOOK);
      if (recalculated.ledgerFingerprint !== assessment.ledgerFingerprint) {
        throw new AppError("conflict", "The Mail review does not match its source snapshot.");
      }
      const row = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(mailReviews)
          .where(
            and(
              eq(mailReviews.userId, userId),
              eq(mailReviews.ledgerFingerprint, assessment.ledgerFingerprint),
            ),
          )
          .orderBy(desc(mailReviews.createdAt))
          .limit(1);
        if (existing) return existing;
        const [created] = await tx
          .insert(mailReviews)
          .values({
            createdAt: now(),
            effectCounts: snapshot.effectCounts,
            evidenceCutoff: new Date(snapshot.now),
            health: assessment.health,
            ledgerFingerprint: assessment.ledgerFingerprint,
            nextMaintenanceAt: new Date(
              new Date(snapshot.now).getTime() +
                MAIL_PLAYBOOK.freshness.currentWithinMinutes * 60_000,
            ),
            obligationCounts: assessment.obligationCounts,
            openQuestionCount: assessment.openQuestionCount,
            playbookVersion: MAIL_PLAYBOOK.version,
            profileVersion: snapshot.profileVersion,
            rulebookVersion: snapshot.rulebookVersion,
            sourceFreshness: snapshot.sourceFreshness,
            state: assessment.proposedSettlement,
            userId,
          })
          .onConflictDoNothing()
          .returning();
        if (!created) {
          const [concurrent] = await tx
            .select()
            .from(mailReviews)
            .where(
              and(
                eq(mailReviews.userId, userId),
                eq(mailReviews.ledgerFingerprint, assessment.ledgerFingerprint),
              ),
            )
            .limit(1);
          if (!concurrent) {
            throw new AppError("internal_error", "The Mail review could not be published.");
          }
          return concurrent;
        }
        await tx.insert(auditEvents).values(
          auditValues({
            action: "mail_review.published",
            after: { id: created.id },
            before: null,
            entityId: created.id,
            entityType: "mail_review",
            principal: {
              actorId: "mail-steward",
              actorType: "agent",
              userId,
            },
            requestId: `mail-review:${assessment.ledgerFingerprint}`,
          }),
        );
        return created;
      });
      return serializeReview(row);
    },

    async getReview(userId: string, id: string): Promise<MailReview> {
      const [review] = await db
        .select()
        .from(mailReviews)
        .where(and(eq(mailReviews.id, id), eq(mailReviews.userId, userId)));
      if (!review) throw new AppError("not_found", "The Mail review was not found.");
      return serializeReview(review);
    },

    async getStatus(userId: string): Promise<MailStatus> {
      const snapshot = await readSnapshot(userId, { type: "all_outstanding" });
      const assessment = assessMail(snapshot, MAIL_PLAYBOOK);
      const [latestReview] = await db
        .select()
        .from(mailReviews)
        .where(eq(mailReviews.userId, userId))
        .orderBy(desc(mailReviews.createdAt))
        .limit(1);
      const [activeRun] = await db
        .select()
        .from(workspaceMaintenanceRuns)
        .where(
          and(
            eq(workspaceMaintenanceRuns.userId, userId),
            eq(workspaceMaintenanceRuns.domain, "mail"),
            inArray(workspaceMaintenanceRuns.status, [
              "queued",
              "running",
              "awaiting_agent_challenge",
              "awaiting_approval",
              "blocked",
              "failed_recoverable",
            ]),
          ),
        )
        .orderBy(desc(workspaceMaintenanceRuns.updatedAt))
        .limit(1);
      const openQuestions = await db
        .select()
        .from(mailStewardshipQuestions)
        .where(
          and(
            eq(mailStewardshipQuestions.userId, userId),
            eq(mailStewardshipQuestions.status, "open"),
          ),
        )
        .orderBy(asc(mailStewardshipQuestions.createdAt));
      const unresolvedObligations =
        assessment.obligationCounts.open +
        assessment.obligationCounts.waiting +
        assessment.obligationCounts.deferred;
      const reviewCurrent = latestReview?.ledgerFingerprint === assessment.ledgerFingerprint;
      const state: MailStatus["state"] =
        assessment.blockers.length > 0
          ? "blocked"
          : assessment.openQuestionCount > 0
            ? "needs_input"
            : !reviewCurrent ||
                unresolvedObligations > 0 ||
                Object.values(snapshot.effectCounts).some((count) => count > 0)
              ? "needs_work"
              : "clean";
      return mailStatusSchema.parse({
        activeRun: activeRun
          ? {
              domain: activeRun.domain,
              id: activeRun.id,
              rulebookVersion: activeRun.rulebookVersion,
              scope: activeRun.scope,
              status: activeRun.status,
              updatedAt: activeRun.updatedAt.toISOString(),
            }
          : null,
        asOf: snapshot.now,
        details: {
          authority: {
            approvedRule: [...MAIL_PLAYBOOK.approvedRule],
            automatic: [...MAIL_PLAYBOOK.automatic],
            individualApproval: [...MAIL_PLAYBOOK.individualApproval],
            unavailable: [...MAIL_PLAYBOOK.unavailable],
          },
          dispositionCounts: assessment.dispositionCounts,
          effectCounts: snapshot.effectCounts,
          health: assessment.health,
          latestReview: latestReview
            ? {
                createdAt: latestReview.createdAt.toISOString(),
                evidenceCutoff: latestReview.evidenceCutoff.toISOString(),
                id: latestReview.id,
                ledgerFingerprint: latestReview.ledgerFingerprint,
                state: latestReview.state,
              }
            : null,
          objective: {
            mode: snapshot.profileId ? "approved_profile" : "default_obligation_integrity",
            profileId: snapshot.profileId,
            profileVersion: snapshot.profileVersion,
            summary: MAIL_PLAYBOOK.defaultObjective,
          },
          obligationCounts: assessment.obligationCounts,
          openQuestionCount: assessment.openQuestionCount,
          openQuestions: openQuestions.map(serializeQuestion),
          playbookVersion: MAIL_PLAYBOOK.version,
          rulebookVersion: snapshot.rulebookVersion,
        },
        domain: "mail",
        freshness: {
          blockers: assessment.blockers.map((code) => ({
            code,
            message: "Mail evidence or provider effects prevent a clean settlement.",
            recovery: "Refresh Mail sources or reconcile the reported provider effect.",
          })),
          observedAt: snapshot.now,
          state: snapshot.sourceFreshness,
        },
        state,
        validNextOperations: [
          { href: "/mail", label: "Review Mail workspace", operation: "review_mail" },
          {
            href: "/mail?view=questions",
            label: "Answer Mail questions",
            operation: "answer_questions",
          },
          { href: null, label: "Maintain Mail workspace", operation: "maintain_mail" },
        ],
        work: {
          actionable: unresolvedObligations,
          awaitingApproval: 0,
          awaitingInput: assessment.openQuestionCount,
          blocked: assessment.blockers.length,
          oldestOutstandingAt: null,
        },
      });
    },
  };
}

export type MailStewardshipService = ReturnType<typeof createMailStewardshipService>;
