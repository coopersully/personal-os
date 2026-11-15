import { z } from "zod";
import { idSchema } from "./common.js";
import {
  type KnowledgeRecordSnapshot,
  knowledgeContentSchema,
  knowledgeEvidenceListSchema,
  knowledgePurposesSchema,
  knowledgeReceiptSchema,
  knowledgeRelatedIdsSchema,
  knowledgeScopeSchema,
  knowledgeSensitivitySchema,
  knowledgeValiditySchema,
  knowledgeWriteContentSchema,
} from "./knowledge.js";
import { unicodeCaseFold } from "./unicode-case-folding.js";

const mutationIdentity = {
  recordId: idSchema,
  expectedRevision: z.int().positive(),
  mutationKey: z.uuid(),
};

const agentKnowledgeActions = [
  z
    .object({
      ...mutationIdentity,
      action: z.literal("revise"),
      content: knowledgeWriteContentSchema,
      evidence: knowledgeEvidenceListSchema.optional(),
      relatedRecordIds: knowledgeRelatedIdsSchema.optional(),
      validity: knowledgeValiditySchema.optional(),
    })
    .strict(),
  z.object({ ...mutationIdentity, action: z.literal("dispute") }).strict(),
  z
    .object({ ...mutationIdentity, action: z.literal("supersede"), replacementId: idSchema })
    .strict(),
] as const;

export const knowledgeAgentLifecycleInputSchema = z.discriminatedUnion(
  "action",
  agentKnowledgeActions,
);
export const knowledgeLifecycleInputSchema = z.discriminatedUnion("action", [
  ...agentKnowledgeActions,
  z.object({ ...mutationIdentity, action: z.literal("confirm") }).strict(),
  z
    .object({
      ...mutationIdentity,
      action: z.literal("restrict"),
      restrictions: z
        .object({
          scope: knowledgeScopeSchema.optional(),
          purposes: knowledgePurposesSchema.optional(),
          sensitivity: knowledgeSensitivitySchema.optional(),
        })
        .strict()
        .refine((restriction) => Object.keys(restriction).length > 0),
    })
    .strict(),
]);
export type KnowledgeLifecycleInput = z.infer<typeof knowledgeLifecycleInputSchema>;

export const knowledgePendingReviewReceiptSchema = z
  .object({
    receiptId: idSchema,
    recordId: idSchema,
    outcome: z.literal("pending_owner_review"),
  })
  .strict();
export const knowledgeForgottenReceiptSchema = z
  .object({ receiptId: idSchema, recordId: idSchema, outcome: z.literal("forgotten") })
  .strict();
export const knowledgeSaveResultSchema = z.discriminatedUnion("outcome", [
  knowledgeReceiptSchema,
  knowledgePendingReviewReceiptSchema,
  knowledgeForgottenReceiptSchema,
]);
export type KnowledgeSaveResult = z.infer<typeof knowledgeSaveResultSchema>;
export const knowledgeMutationResultSchema = z.discriminatedUnion("outcome", [
  ...knowledgeSaveResultSchema.options,
  z
    .object({
      receiptId: idSchema,
      recordId: idSchema,
      outcome: z.literal("pending_erasure"),
      operationId: idSchema,
    })
    .strict(),
]);
export type KnowledgeMutationResult = z.infer<typeof knowledgeMutationResultSchema>;

export const knowledgeForgetPreviewInputSchema = z
  .object({
    recordId: idSchema,
    cursor: z
      .object({
        previewId: idSchema,
        ownerEpoch: z.int().nonnegative(),
        recordId: idSchema,
        revision: z.int().positive(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const knowledgeForgetPreviewSchema = z
  .object({
    previewId: idSchema,
    ownerEpoch: z.int().nonnegative(),
    recordId: idSchema,
    affected: z
      .array(z.object({ recordId: idSchema, revision: z.int().positive() }).strict())
      .max(50),
    dependentCopyCount: z.int().nonnegative(),
    historyCount: z.int().nonnegative(),
    nextCursor: knowledgeForgetPreviewInputSchema.shape.cursor.unwrap().nullable(),
  })
  .strict();
export const knowledgeForgetInputSchema = z
  .object({ previewId: idSchema, ownerEpoch: z.int().nonnegative(), mutationKey: z.uuid() })
  .strict();
export const knowledgeForgetOperationInputSchema = z.object({ operationId: idSchema }).strict();
/** Authorized content callers can distinguish a durable fence from generic unavailability. */
export const knowledgeErasurePendingReason = "knowledge_erasure_pending";
export const knowledgeForgetStatusSchema = knowledgeForgetOperationInputSchema.extend({
  status: z.enum(["pending", "blocked", "completed"]),
});
// The owner-level erasure fence permits at most one active operation.
export const activeKnowledgeForgetOperationsSchema = z
  .array(knowledgeForgetOperationInputSchema.extend({ status: z.enum(["pending", "blocked"]) }))
  .max(1);
export type KnowledgeForgetPreviewInput = z.infer<typeof knowledgeForgetPreviewInputSchema>;
export type KnowledgeForgetPreview = z.infer<typeof knowledgeForgetPreviewSchema>;
export type KnowledgeForgetInput = z.infer<typeof knowledgeForgetInputSchema>;
export type KnowledgeForgetOperationInput = z.infer<typeof knowledgeForgetOperationInputSchema>;
export type KnowledgeForgetStatus = z.infer<typeof knowledgeForgetStatusSchema>;

export const knowledgeDerivationKindSchema = z.enum([
  "source_record",
  "entity_meaning",
  "content_evidence",
  "revision_proposal",
]);
export type KnowledgeDerivationKind = z.infer<typeof knowledgeDerivationKindSchema>;

export function normalizeKnowledgeIdentifier(value: string): string {
  return unicodeCaseFold(value.trim().replace(/\s+/gu, " ").normalize("NFC")).normalize("NFC");
}

export function knowledgeClaimKey(
  workspace: KnowledgeRecordSnapshot["scope"]["workspace"],
  content: KnowledgeRecordSnapshot["content"],
): string | null {
  const { kind, value } = content;
  switch (kind) {
    case "fact":
      return JSON.stringify([
        workspace,
        kind,
        normalizeKnowledgeIdentifier(value.subject),
        normalizeKnowledgeIdentifier(value.predicate),
      ]);
    case "preference":
      return JSON.stringify([
        workspace,
        kind,
        normalizeKnowledgeIdentifier(value.subject),
        normalizeKnowledgeIdentifier(value.key),
      ]);
    case "relationship":
      return JSON.stringify([
        workspace,
        kind,
        value.subjectId.toLowerCase(),
        normalizeKnowledgeIdentifier(value.relationship),
      ]);
    case "goal":
      return JSON.stringify([workspace, kind, value.goalId.toLowerCase()]);
    case "entity_meaning":
      return JSON.stringify([workspace, kind, value.recordId.toLowerCase(), value.purpose]);
    case "constraint":
      return JSON.stringify([
        workspace,
        kind,
        normalizeKnowledgeIdentifier(value.subject),
        normalizeKnowledgeIdentifier(value.condition),
      ]);
    case "routine":
      return JSON.stringify([
        workspace,
        kind,
        normalizeKnowledgeIdentifier(value.subject),
        normalizeKnowledgeIdentifier(value.recurrence),
      ]);
    case "decision":
      return JSON.stringify([workspace, kind, normalizeKnowledgeIdentifier(value.subject)]);
    case "inference":
      return null;
  }
}

export function knowledgeClaimValue({ kind, value }: KnowledgeRecordSnapshot["content"]): unknown {
  switch (kind) {
    case "fact":
    case "preference":
      return value.value;
    case "relationship":
      return [value.objectId.toLowerCase(), value.direction];
    case "goal":
      return value.goalId.toLowerCase();
    case "entity_meaning":
      return value.meaning;
    case "constraint":
      return value.boundary;
    case "routine":
      return value.classification;
    case "decision":
      return value.option;
    case "inference":
      return null;
  }
}

export function knowledgeClaimContent(
  record: KnowledgeRecordSnapshot,
  generatedInference: boolean,
) {
  if (!generatedInference || record.content.kind !== "inference") return record.content;
  return knowledgeContentSchema.parse(JSON.parse(record.content.value.proposition));
}
