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
/** Trash, restore and delete now are person-only record states; they never create a revision. */
export const knowledgeTrashActionSchema = z.enum(["trash", "restore", "delete_now"]);
export type KnowledgeTrashAction = z.infer<typeof knowledgeTrashActionSchema>;
/** Trashed memory stays recoverable this long before the purge job erases it. */
export const knowledgeTrashRetentionMs = 30 * 24 * 60 * 60 * 1000;

export const knowledgeTrashInputSchema = z.object(mutationIdentity).strict();
export type KnowledgeTrashInput = z.infer<typeof knowledgeTrashInputSchema>;

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
  knowledgeTrashInputSchema.extend({ action: z.literal("trash") }),
  knowledgeTrashInputSchema.extend({ action: z.literal("restore") }),
  knowledgeTrashInputSchema.extend({ action: z.literal("delete_now") }),
]);
export type KnowledgeLifecycleInput = z.infer<typeof knowledgeLifecycleInputSchema>;

export const knowledgePendingReviewReceiptSchema = z
  .object({
    receiptId: idSchema,
    recordId: idSchema,
    outcome: z.literal("pending_owner_review"),
  })
  .strict();
/** Content-free receipt for a record in the owner's Trash. Agents receive `forgotten` instead. */
export const knowledgeTrashedReceiptSchema = z
  .object({ receiptId: idSchema, recordId: idSchema, outcome: z.literal("trashed") })
  .strict();
export const knowledgeForgottenReceiptSchema = z
  .object({ receiptId: idSchema, recordId: idSchema, outcome: z.literal("forgotten") })
  .strict();
export const knowledgeSaveResultSchema = z.discriminatedUnion("outcome", [
  knowledgeReceiptSchema,
  knowledgePendingReviewReceiptSchema,
  knowledgeTrashedReceiptSchema,
  knowledgeForgottenReceiptSchema,
]);
export type KnowledgeSaveResult = z.infer<typeof knowledgeSaveResultSchema>;
export const knowledgeMutationResultSchema = knowledgeSaveResultSchema;
export type KnowledgeMutationResult = KnowledgeSaveResult;

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
