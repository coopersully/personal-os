import {
  auditEvents,
  type Database,
  mailMessages,
  mailObligations,
  mailStewardshipQuestions,
  mailThreadDispositions,
  mailThreads,
} from "@personal-os/database";
import type {
  CreateMailObligationInput,
  MailDisposition,
  MailObligation,
  MailStewardshipQuestion,
  MailThreadStewardship,
  SetMailDispositionInput,
  UpdateMailObligationInput,
} from "@personal-os/domain";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { auditValues } from "./audit.js";
import { AppError } from "./errors.js";
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
        const [row] = await tx
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
          .returning();
        if (!row) throw new AppError("internal_error", "The obligation could not be created.");
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
        const [row] = await tx
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
          .returning();
        if (!row) throw new AppError("internal_error", "The obligation could not be updated.");
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
        const [row] = await tx
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
          .returning();
        if (!row) throw new AppError("internal_error", "The disposition could not be recorded.");
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
  };
}

export type MailStewardshipService = ReturnType<typeof createMailStewardshipService>;
