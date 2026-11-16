import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./common.js";
import {
  knowledgeContentSchema,
  knowledgeOriginSchema,
  knowledgePurposeSchema,
  knowledgeRecordSchema,
  knowledgeWorkspaceSchema,
} from "./knowledge.js";
import { knowledgeTagsInputSchema } from "./knowledge-tags.js";

export const knowledgeRetrievalMaxRecords = 50;
export const knowledgeContextMaxBytes = 32_768;
const cursor = z.string().min(1).max(2_048);
const epoch = z.int().nonnegative();
const entityRefs = z
  .array(idSchema.transform((id) => id.toLowerCase()))
  .max(20)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "Entity references must be unique.",
  });
const timeWindow = z
  .object({ from: isoDateTimeSchema, to: isoDateTimeSchema })
  .strict()
  .refine(({ from, to }) => Date.parse(from) < Date.parse(to), {
    path: ["to"],
    message: "The time window must end after it begins.",
  });

/** Query fields without cross-field checks, for adapters that reshape them. */
export const knowledgeQueryObjectSchema = z
  .object({
    /** Ranks records saved for this purpose first; it never hides a record. */
    purpose: knowledgePurposeSchema.optional(),
    workspace: knowledgeWorkspaceSchema.optional(),
    entityRefs: entityRefs.optional(),
    timeWindow: timeWindow.optional(),
    text: z
      .string()
      .max(500)
      .trim()
      .min(1)
      .refine((value) => !value.includes("\u0000") && !/[\uD800-\uDFFF]/u.test(value))
      .optional(),
    /** `trashed` is an owner-only view of the Trash, not a record status. */
    status: z.enum([...knowledgeRecordSchema.shape.status.options, "trashed"]).optional(),
    kind: z
      .enum(knowledgeContentSchema.options.map((schema) => schema.shape.kind.value))
      .optional(),
    origin: knowledgeOriginSchema.optional(),
    /** Tags (aliases resolve to their canonical tag). Exact tag matches rank above text. */
    tags: knowledgeTagsInputSchema.optional(),
    /** How `tags` combine; omitted means `any`. */
    tagMatch: z.enum(["any", "all"]).optional(),
    hasConflict: z.boolean().optional(),
    reviewView: z.enum(["accepted", "needs_review"]).optional(),
    limit: z.int().min(1).max(knowledgeRetrievalMaxRecords).optional(),
    cursor: cursor.optional(),
  })
  .strict();
function tagMatchNeedsTags({
  tags,
  tagMatch,
}: {
  tags?: string[] | undefined;
  tagMatch?: string | undefined;
}) {
  return tagMatch === undefined || tags !== undefined;
}
const tagMatchMessage = { path: ["tagMatch"], message: "tagMatch requires tags." };
export const knowledgeQuerySchema = knowledgeQueryObjectSchema.refine(
  tagMatchNeedsTags,
  tagMatchMessage,
);
export type KnowledgeQuery = z.infer<typeof knowledgeQuerySchema>;
/** Agents never see Trash, so their query surface omits the owner-only `trashed` view. */
export const knowledgeAgentQuerySchema = knowledgeQueryObjectSchema
  .extend({ status: knowledgeRecordSchema.shape.status.optional() })
  .refine(tagMatchNeedsTags, tagMatchMessage);

export const knowledgeHistoryInputSchema = z
  .object({
    recordId: idSchema.transform((id) => id.toLowerCase()),
    purpose: knowledgePurposeSchema.optional(),
    cursor: cursor.optional(),
  })
  .strict();
export type KnowledgeHistoryInput = z.infer<typeof knowledgeHistoryInputSchema>;
export const knowledgeExportInputSchema = z.object({ cursor: cursor.optional() }).strict();
export type KnowledgeExportInput = z.infer<typeof knowledgeExportInputSchema>;

export const knowledgePageSchema = z
  .object({
    schemaVersion: z.literal(1),
    items: z.array(knowledgeRecordSchema).max(knowledgeRetrievalMaxRecords),
    nextCursor: cursor.nullable(),
    epoch,
    state: z.enum(["available", "partial", "unavailable"]),
  })
  .strict();
export type KnowledgePage = z.infer<typeof knowledgePageSchema>;

export const knowledgeRecordReferenceSchema = z
  .object({ recordId: idSchema, revision: z.int().positive() })
  .strict();
export type KnowledgeRecordReference = z.infer<typeof knowledgeRecordReferenceSchema>;
export const knowledgeContextReasonSchema = z.enum([
  "stated",
  "inferred",
  "tentative",
  "conflicts",
]);
export type KnowledgeContextReason = z.infer<typeof knowledgeContextReasonSchema>;
export const knowledgeContextReferenceSchema = knowledgeRecordReferenceSchema.extend({
  reason: knowledgeContextReasonSchema,
});
export type KnowledgeContextReference = z.infer<typeof knowledgeContextReferenceSchema>;

const section = z.array(knowledgeRecordSchema).max(knowledgeRetrievalMaxRecords);
export const knowledgeContextPackSchema = z
  .object({
    schemaVersion: z.literal(1),
    contextUseId: idSchema,
    stated: section,
    inferred: section,
    tentative: section,
    conflicts: section,
    missingInputs: z.array(z.enum(["no_current_memory", "source_unavailable"])).max(2),
    truncated: z.boolean(),
    nextCursor: cursor.nullable(),
    nextFetchRefs: z.array(knowledgeRecordReferenceSchema).max(1),
    epoch,
  })
  .strict()
  .refine(
    ({ stated, inferred, tentative, conflicts }) =>
      stated.length + inferred.length + tentative.length + conflicts.length <=
      knowledgeRetrievalMaxRecords,
    "A context pack cannot exceed 50 records.",
  )
  .refine(
    (pack) => new TextEncoder().encode(JSON.stringify(pack)).byteLength <= knowledgeContextMaxBytes,
    "A context pack cannot exceed 32 KiB.",
  );
export type KnowledgeContextPack = z.infer<typeof knowledgeContextPackSchema>;

export const knowledgeExplainInputSchema = z.object({ contextUseId: idSchema }).strict();
export type KnowledgeExplainInput = z.infer<typeof knowledgeExplainInputSchema>;
const explainedRecord = knowledgeContextReferenceSchema.extend({ origin: knowledgeOriginSchema });
export const knowledgeContextExplanationSchema = z.discriminatedUnion("state", [
  z
    .object({
      contextUseId: idSchema,
      state: z.enum(["available", "changed"]),
      references: z.array(explainedRecord).max(knowledgeRetrievalMaxRecords),
    })
    .strict(),
  z
    .object({
      contextUseId: idSchema,
      state: z.literal("unavailable"),
    })
    .strict(),
]);
export type KnowledgeContextExplanation = z.infer<typeof knowledgeContextExplanationSchema>;
