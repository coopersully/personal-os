import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  auditEvents,
  type Database,
  financeContextualAnswers,
  financeConversationMessages,
  financeMutationRecords,
} from "@personal-os/database";
import {
  type FinanceActivityEntry,
  type FinanceActivityPage,
  type FinanceActivityQuery,
  financeActivityEntrySchema,
  financeActivityQuerySchema,
  idSchema,
  isoDateTimeSchema,
} from "@personal-os/domain";
import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError } from "../errors.js";

type Audit = typeof auditEvents.$inferSelect;
type Message = typeof financeConversationMessages.$inferSelect;
type Receipt = typeof financeMutationRecords.$inferSelect;
type Answer = typeof financeContextualAnswers.$inferSelect;
export type FinanceActivityDecisionSource = {
  audit: Audit;
  message: Message;
  receipt: Receipt;
  answer: Answer | null;
};
const cursorSchema = z
  .object({
    owner: idSchema,
    filtersHash: z.string().regex(/^[a-f0-9]{64}$/u),
    at: isoDateTimeSchema,
    id: idSchema,
  })
  .strict();
type Cursor = z.infer<typeof cursorSchema>;
function filterHash(query: FinanceActivityQuery) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        type: query.type ?? null,
        actor: query.actor ?? null,
        recordId: query.recordId ?? null,
        from: query.from ?? null,
        through: query.through ?? null,
      }),
    )
    .digest("hex");
}
export function encodeFinanceActivityCursor(
  userId: string,
  query: FinanceActivityQuery,
  position: { at: string; id: string },
  secret: string,
): string {
  const payload = Buffer.from(
    JSON.stringify({ owner: userId, filtersHash: filterHash(query), ...position }),
  ).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(`finance-activity:${payload}`).digest("hex")}`;
}
export function decodeFinanceActivityCursor(
  userId: string,
  query: FinanceActivityQuery,
  secret: string,
): Cursor | null {
  if (!query.cursor) return null;
  try {
    const [payload, signature, extra] = query.cursor.split(".");
    if (!payload || !signature || extra) throw new Error("cursor format");
    const expected = createHmac("sha256", secret)
      .update(`finance-activity:${payload}`)
      .digest("hex");
    if (
      signature.length !== expected.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    )
      throw new Error("cursor signature");
    const value = cursorSchema.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
    if (value.owner !== userId || value.filtersHash !== filterHash(query))
      throw new Error("cursor scope");
    return value;
  } catch {
    throw new AppError(
      "invalid_request",
      "Use the Activity cursor for this owner and exact filters.",
    );
  }
}

/** Trusted canonical producer linkage, never reply text or a guessed financial outcome. */
export function projectFinanceActivityDecision(
  userId: string,
  source: FinanceActivityDecisionSource,
): FinanceActivityEntry | null {
  const { audit, message, receipt, answer } = source;
  const operationId = message.sourceOperationId;
  const questionRef = message.recordRefs.find((ref) => ref.kind === "contextual_question");
  const caseRef = message.recordRefs.find((ref) => ref.kind === "review_case");
  if (
    !operationId ||
    audit.userId !== userId ||
    message.userId !== userId ||
    receipt.userId !== userId ||
    audit.action !== "finance.contextual_answer.accepted" ||
    audit.entityType !== "finance_contextual_question" ||
    audit.actorType !== "user" ||
    audit.actorId !== userId ||
    !audit.requestId ||
    audit.after?.state !== "accepted" ||
    audit.after.operationId !== operationId ||
    !idSchema.safeParse(audit.after.answerId).success ||
    message.authorKind !== "user" ||
    message.idempotencyKey !== `answer:${operationId}` ||
    questionRef?.id !== audit.entityId ||
    receipt.idempotencyKey !== operationId ||
    receipt.operation !== "answer_contextual_question_v1" ||
    receipt.actorType !== "user" ||
    receipt.actorId !== userId ||
    receipt.status !== "completed" ||
    receipt.response?.state !== "accepted" ||
    receipt.response.operationId !== operationId ||
    receipt.response.resultRevision !== audit.after.revision
  )
    return null;
  if (
    answer &&
    (answer.userId !== userId ||
      answer.id !== audit.after.answerId ||
      answer.questionId !== audit.entityId ||
      answer.operationId !== operationId ||
      answer.actorType !== "user" ||
      answer.actorId !== userId ||
      answer.requestId !== audit.requestId ||
      answer.text !== message.text ||
      answer.resultingWorkRevision.toString() !== audit.after.revision)
  )
    return null;
  const recordRefs = message.recordRefs;
  return financeActivityEntrySchema.parse({
    id: audit.id,
    occurredAt: audit.createdAt.toISOString(),
    kind: "human_answer_decision",
    status: "accepted",
    actor: { type: "user", id: userId },
    action: audit.action,
    explanation:
      "Your answer was accepted for the linked Finance question. This records your decision; it does not establish an applied financial change.",
    caseId: caseRef?.id ?? message.caseId,
    runId: null,
    actionId: operationId,
    sourceOperationId: operationId,
    auditEventIds: [audit.id],
    sourceMessages: [
      {
        id: message.id,
        sequence: message.sequence.toString(),
        text: message.text,
        createdAt: message.createdAt.toISOString(),
        contentHash: createHash("sha256").update(message.text).digest("hex"),
        excerpt: null,
      },
    ],
    recordRefs,
    changes: [],
    targets: [
      { kind: "chat", id: message.id },
      ...recordRefs
        .filter((ref) => ref.kind === "review_case" || ref.kind === "transaction")
        .map((ref) => ({ kind: ref.kind, id: ref.id })),
    ],
  });
}
function page(entries: FinanceActivityEntry[], nextCursor: string | null): FinanceActivityPage {
  return {
    entries,
    nextCursor,
    capabilities: {
      financialActions: { state: "unavailable", reason: "mutation_evidence_not_integrated" },
      humanDecisions: { state: "available" },
    },
    coverage: {
      state: "partial",
      reasons: [
        "financial_mutation_evidence_not_integrated",
        "historical_decisions_without_causal_message_not_projected",
      ],
    },
  };
}

/** Human-only adapter calls this projection. No pending queue or execution path is exposed. */
export function createFinanceActivityService({
  db,
  cursorSecret,
}: {
  db: Database;
  cursorSecret: string;
}) {
  if (!cursorSecret)
    throw new AppError("internal_error", "The existing server cursor secret is required.");
  return {
    async listActivity(userId: string, raw: FinanceActivityQuery): Promise<FinanceActivityPage> {
      const query = financeActivityQuerySchema.parse(raw);
      const cursor = decodeFinanceActivityCursor(userId, query, cursorSecret);
      if (query.type === "financial_action" || (query.actor && query.actor !== "user"))
        return page([], null);
      // Canonical receipt and audit remain after live question/answer deletion.
      const rows = await db
        .select({
          audit: auditEvents,
          message: financeConversationMessages,
          receipt: financeMutationRecords,
          answer: financeContextualAnswers,
          cursorAt: sql<string>`to_char(${auditEvents.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        })
        .from(auditEvents)
        .innerJoin(
          financeConversationMessages,
          and(
            eq(financeConversationMessages.userId, auditEvents.userId),
            eq(financeConversationMessages.authorKind, "user"),
            sql`${financeConversationMessages.sourceOperationId}::text = ${auditEvents.after}->>'operationId'`,
            sql`${financeConversationMessages.idempotencyKey} = 'answer:' || (${auditEvents.after}->>'operationId')`,
            sql`${financeConversationMessages.recordRefs} @> jsonb_build_array(jsonb_build_object('kind','contextual_question','id',${auditEvents.entityId}::text))`,
          ),
        )
        .innerJoin(
          financeMutationRecords,
          and(
            eq(financeMutationRecords.userId, auditEvents.userId),
            sql`${financeMutationRecords.idempotencyKey} = ${auditEvents.after}->>'operationId'`,
            eq(financeMutationRecords.operation, "answer_contextual_question_v1"),
            eq(financeMutationRecords.actorType, "user"),
            eq(financeMutationRecords.actorId, userId),
            eq(financeMutationRecords.status, "completed"),
            sql`${financeMutationRecords.response}->>'state' = 'accepted'`,
            sql`${financeMutationRecords.response}->>'operationId' = ${auditEvents.after}->>'operationId'`,
            sql`${financeMutationRecords.response}->>'resultRevision' = ${auditEvents.after}->>'revision'`,
          ),
        )
        .leftJoin(
          financeContextualAnswers,
          and(
            eq(financeContextualAnswers.userId, auditEvents.userId),
            sql`${financeContextualAnswers.id}::text = ${auditEvents.after}->>'answerId'`,
          ),
        )
        .where(
          and(
            eq(auditEvents.userId, userId),
            eq(auditEvents.action, "finance.contextual_answer.accepted"),
            eq(auditEvents.entityType, "finance_contextual_question"),
            eq(auditEvents.actorType, "user"),
            eq(auditEvents.actorId, userId),
            sql`length(${auditEvents.requestId}) > 0`,
            sql`${auditEvents.after}->>'state' = 'accepted'`,
            sql`${auditEvents.after}->>'answerId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
            sql`(${financeContextualAnswers.id} IS NULL OR (${financeContextualAnswers.operationId}::text = ${auditEvents.after}->>'operationId' AND ${financeContextualAnswers.questionId} = ${auditEvents.entityId} AND ${financeContextualAnswers.actorType} = 'user' AND ${financeContextualAnswers.actorId} = ${userId} AND ${financeContextualAnswers.requestId} = ${auditEvents.requestId} AND ${financeContextualAnswers.text} = ${financeConversationMessages.text} AND ${financeContextualAnswers.resultingWorkRevision}::text = ${auditEvents.after}->>'revision'))`,
            query.recordId
              ? sql`${financeConversationMessages.recordRefs} @> jsonb_build_array(jsonb_build_object('id',${query.recordId}::text))`
              : undefined,
            query.from ? sql`${auditEvents.createdAt} >= ${query.from}::timestamptz` : undefined,
            query.through
              ? sql`${auditEvents.createdAt} <= ${query.through}::timestamptz`
              : undefined,
            cursor
              ? or(
                  sql`${auditEvents.createdAt} < ${cursor.at}::timestamptz`,
                  and(
                    sql`${auditEvents.createdAt} = ${cursor.at}::timestamptz`,
                    lt(auditEvents.id, cursor.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
        .limit(query.limit + 1);
      const entries = rows
        .slice(0, query.limit)
        .map((source) => projectFinanceActivityDecision(userId, source))
        .filter((entry): entry is FinanceActivityEntry => entry !== null);
      const last = rows.slice(0, query.limit).at(-1);
      return page(
        entries,
        rows.length > query.limit && last
          ? encodeFinanceActivityCursor(
              userId,
              query,
              { at: last.cursorAt, id: last.audit.id },
              cursorSecret,
            )
          : null,
      );
    },
  };
}
