import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type {
  auditEvents,
  financeConversationEvidence,
  financeConversationMessages,
  financeMutationRecords,
} from "@personal-os/database";
import {
  type FinanceActivityEntry,
  type FinanceActivityEvidencePage,
  type FinanceConversationEffectReceipt,
  financeActivityEntrySchema,
  financeActivityEvidencePageSchema,
  financeConversationEffectReceiptSchema,
  idSchema,
} from "@personal-os/domain";
import { z } from "zod";
import { AppError } from "../errors.js";

type Mutation = typeof financeMutationRecords.$inferSelect;
type Audit = typeof auditEvents.$inferSelect;
type Message = typeof financeConversationMessages.$inferSelect;
type Evidence = typeof financeConversationEvidence.$inferSelect;
export type FinanceActivityEffectSource = {
  mutation: Mutation;
  receipt: FinanceConversationEffectReceipt;
  audits: Audit[];
  messages: Message[];
  causalEvidence: Evidence | null;
};

export function readFinanceActivityReceipt(
  owner: string,
  mutation: Mutation,
): FinanceConversationEffectReceipt | null {
  const parsed = financeConversationEffectReceiptSchema.safeParse(
    mutation.response?.financeEffectReceipt,
  );
  if (!parsed.success) return null;
  const receipt = parsed.data;
  if (
    mutation.userId !== owner ||
    mutation.operation !== "commit_finance_candidate_effect_v1" ||
    mutation.status !== "completed" ||
    !mutation.completedAt ||
    receipt.status !== "applied" ||
    receipt.outcome !== "committed" ||
    receipt.auditEventIds.length === 0 ||
    (receipt.humanApproval !== null && receipt.humanApproval.actorId !== owner) ||
    (receipt.authorityBasis === "authenticated_owner" &&
      (receipt.actor.type !== "user" || receipt.actor.id !== owner)) ||
    (receipt.authorityBasis === "original_live_grant" &&
      (!receipt.automationScheduleId || !receipt.authorizationConnectionId)) ||
    receipt.id !== mutation.id ||
    receipt.requestId !== `finance-candidate-effect:${mutation.id}` ||
    mutation.idempotencyKey !==
      `finance-candidate-effect:${receipt.candidateId}:${receipt.candidateRevision}` ||
    mutation.actorType !== receipt.actor.type ||
    mutation.actorId !== receipt.actor.id ||
    new Set(receipt.auditEventIds).size !== receipt.auditEventIds.length ||
    new Set(receipt.sourceMessageIds).size !== receipt.sourceMessageIds.length
  )
    return null;
  return receipt;
}

/** Normalize only routes whose owning records are established; retain every raw reference. */
export function financeActivityRecordRef(ref: { kind: string; id: string }) {
  const known: Record<string, string> = {
    finance_transaction: "transaction",
    finance_account: "account",
    finance_review_case: "review_case",
    finance_contextual_question: "contextual_question",
  };
  return {
    kind: Object.hasOwn(known, ref.kind) ? (known[ref.kind] ?? ref.kind) : ref.kind,
    id: ref.id,
    sourceKind: ref.kind,
  };
}
const evidenceCursor = z
  .object({
    owner: idSchema,
    receiptId: idSchema,
    revision: z.string(),
    digest: z.string(),
    offset: z.number().int().min(0).max(9999),
  })
  .strict();
function receiptDigest(receipt: FinanceConversationEffectReceipt) {
  return createHash("sha256").update(JSON.stringify(receipt)).digest("hex");
}
export function encodeFinanceActivityEvidenceCursor(
  owner: string,
  receipt: FinanceConversationEffectReceipt,
  offset: number,
  secret: string,
) {
  const payload = Buffer.from(
    JSON.stringify({
      owner,
      receiptId: receipt.id,
      revision: receipt.candidateRevision,
      digest: receiptDigest(receipt),
      offset,
    }),
  ).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(`finance-activity-evidence:${payload}`).digest("hex")}`;
}
export function decodeFinanceActivityEvidenceCursor(
  owner: string,
  receipt: FinanceConversationEffectReceipt,
  cursor: string | undefined,
  secret: string,
) {
  if (!cursor) return 0;
  try {
    const [payload, signature, extra] = cursor.split(".");
    if (!payload || !signature || extra) throw new Error("format");
    const expected = createHmac("sha256", secret)
      .update(`finance-activity-evidence:${payload}`)
      .digest("hex");
    if (
      signature.length !== expected.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    )
      throw new Error("signature");
    const parsed = evidenceCursor.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
    if (
      parsed.owner !== owner ||
      parsed.receiptId !== receipt.id ||
      parsed.revision !== receipt.candidateRevision ||
      parsed.digest !== receiptDigest(receipt) ||
      parsed.offset >= receipt.auditEventIds.length ||
      parsed.offset % 100 !== 0
    )
      throw new Error("binding");
    return parsed.offset;
  } catch {
    throw new AppError(
      "invalid_request",
      "Use the exact Activity evidence cursor for this owner and unchanged receipt.",
    );
  }
}
function validateSources(owner: string, source: FinanceActivityEffectSource) {
  const { receipt, messages, causalEvidence } = source;
  const verified = readFinanceActivityReceipt(owner, source.mutation);
  if (!verified || !isDeepStrictEqual(verified, receipt)) return false;
  if (
    messages.length !== receipt.sourceMessageIds.length ||
    messages.some(
      (message) => message.userId !== owner || !receipt.sourceMessageIds.includes(message.id),
    ) ||
    new Set(messages.map((message) => message.id)).size !== messages.length
  )
    return false;
  if (
    receipt.sourceMessageIds.length &&
    (!causalEvidence ||
      causalEvidence.userId !== owner ||
      causalEvidence.runId !== receipt.runId ||
      causalEvidence.actionKey !== source.mutation.idempotencyKey ||
      causalEvidence.sourceOperationId !== receipt.candidateId ||
      causalEvidence.explanation !== receipt.explanation ||
      JSON.stringify(causalEvidence.sourceMessageIds) !== JSON.stringify(receipt.sourceMessageIds))
  )
    return false;
  return true;
}
export function projectFinanceActivityEvidence(
  owner: string,
  source: FinanceActivityEffectSource,
  offset: number,
  secret: string,
): FinanceActivityEvidencePage | null {
  if (!validateSources(owner, source)) return null;
  const ids = source.receipt.auditEventIds.slice(offset, offset + 100);
  const audits = ids.map((id) => source.audits.find((audit) => audit.id === id));
  if (
    !ids.length ||
    audits.some(
      (audit) =>
        !audit ||
        audit.userId !== owner ||
        audit.requestId !== source.receipt.requestId ||
        !source.receipt.recordRefs.some(
          (ref) => ref.kind === audit.entityType && ref.id === audit.entityId,
        ),
    )
  )
    return null;
  const changes = audits.map((audit) => {
    if (!audit) throw new Error("Validated audit missing");
    const sourceRecordRef = { kind: audit.entityType, id: audit.entityId };
    return {
      id: audit.id,
      recordRef: financeActivityRecordRef(sourceRecordRef),
      sourceRecordRef,
      before: audit.before,
      after: audit.after,
      auditEventIds: [audit.id],
      actor: { type: audit.actorType, id: audit.actorId },
      occurredAt: audit.createdAt.toISOString(),
      action: audit.action,
    };
  });
  const end = offset + ids.length;
  return financeActivityEvidencePageSchema.parse({
    entryId: source.receipt.id,
    changes,
    auditEventIds: ids,
    recordRefs: [
      ...new Map(
        changes.map((change) => [
          `${change.recordRef.kind}:${change.recordRef.id}`,
          change.recordRef,
        ]),
      ).values(),
    ],
    offset,
    totalChanges: source.receipt.auditEventIds.length,
    nextCursor:
      end < source.receipt.auditEventIds.length
        ? encodeFinanceActivityEvidenceCursor(owner, source.receipt, end, secret)
        : null,
  });
}
export function projectFinanceActivityEffect(
  owner: string,
  source: FinanceActivityEffectSource,
  secret: string,
): FinanceActivityEntry | null {
  const evidence = projectFinanceActivityEvidence(owner, source, 0, secret);
  if (!evidence) return null;
  const receipt = source.receipt;
  return financeActivityEntrySchema.parse({
    id: receipt.id,
    occurredAt: receipt.committedAt,
    kind: "financial_action",
    status: "applied",
    actor: receipt.actor,
    action: receipt.actionFamilies.join(", ").slice(0, 160) || "Financial candidate applied",
    explanation: receipt.explanation,
    caseId: null,
    runId: receipt.runId,
    actionId: source.mutation.idempotencyKey,
    sourceOperationId: receipt.candidateId,
    auditEventIds: evidence.auditEventIds,
    sourceMessages: receipt.sourceMessageIds.map((id) => {
      const message = source.messages.find((message) => message.id === id);
      if (!message) throw new Error("Validated source missing");
      return {
        id: message.id,
        sequence: message.sequence.toString(),
        text: message.text,
        createdAt: message.createdAt.toISOString(),
        contentHash: createHash("sha256").update(message.text).digest("hex"),
        excerpt: null,
      };
    }),
    recordRefs: evidence.recordRefs,
    changes: evidence.changes,
    targets: [],
    effect: {
      candidateId: receipt.candidateId,
      candidateRevision: receipt.candidateRevision,
      authorityBasis: receipt.authorityBasis,
      actionFamilies: receipt.actionFamilies,
      significance: receipt.significance,
      humanApproval: receipt.humanApproval,
    },
    evidence: {
      totalChanges: evidence.totalChanges,
      loadedChanges: evidence.changes.length,
      nextCursor: evidence.nextCursor,
    },
  });
}
