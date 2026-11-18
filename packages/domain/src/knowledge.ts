import { z } from "zod";
import { accessScopeSchema } from "./auth.js";
import { idSchema, isoDateTimeSchema } from "./common.js";
import { knowledgeTagsInputSchema } from "./knowledge-tags.js";

// PostgreSQL JSONB rejects NUL and unpaired UTF-16 surrogates. Validate before
// persistence rather than replacing or truncating accepted personal knowledge.
const storableText = (value: string) =>
  !value.includes("\u0000") && !/[\uD800-\uDFFF]/u.test(value);
const text = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine(storableText, "Text cannot contain NUL or unpaired surrogates.");
const knowledgeValueMaxBytes = 8192;
// Inferred propositions preserve JSON.stringify({ kind, value }) losslessly. The
// fixed kind/value wrapper is under 64 ASCII bytes for every supported kind.
const inferenceProposition = z
  .string()
  .trim()
  .min(1)
  .max(knowledgeValueMaxBytes + 64)
  .refine(storableText, "Text cannot contain NUL or unpaired surrogates.");
export const knowledgePurposeSchema = z.enum([
  "setup",
  "bookkeeping",
  "planning",
  "review",
  "communication",
  "recovery",
]);
export type KnowledgePurpose = z.infer<typeof knowledgePurposeSchema>;
export const knowledgeWorkspaceSchema = z.enum(["tasks", "calendar", "mail", "finances"]);
export const knowledgeScopeSchema = z
  .object({ workspace: knowledgeWorkspaceSchema.nullable().default(null) })
  .strict();
const typedValue = z.discriminatedUnion("type", [
  z.object({ type: z.literal("string"), value: text }).strict(),
  z.object({ type: z.literal("boolean"), value: z.boolean() }).strict(),
  z.object({ type: z.literal("integer"), value: z.int() }).strict(),
  z.object({ type: z.literal("date"), value: z.iso.date() }).strict(),
]);
export const knowledgeContentSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("fact"),
      value: z.object({ subject: text, predicate: text, value: typedValue }).strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("preference"),
      value: z.object({ subject: text, key: text, value: typedValue }).strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("relationship"),
      value: z
        .object({
          subjectId: idSchema,
          objectId: idSchema,
          relationship: text,
          direction: z.enum(["directed", "bidirectional"]),
        })
        .strict(),
    })
    .strict(),
  z.object({ kind: z.literal("goal"), value: z.object({ goalId: idSchema }).strict() }).strict(),
  z
    .object({
      kind: z.literal("constraint"),
      value: z
        .object({
          subject: text,
          condition: text,
          boundary: text,
          validFrom: isoDateTimeSchema,
          validUntil: isoDateTimeSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("routine"),
      value: z
        .object({
          subject: text,
          recurrence: text,
          classification: z.enum(["stated", "observed"]),
          validFrom: isoDateTimeSchema,
          validUntil: isoDateTimeSchema,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("decision"),
      value: z
        .object({
          subject: text,
          option: text,
          reason: text,
          evidenceIds: z.array(idSchema).max(20),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("entity_meaning"),
      value: z
        .object({ recordId: idSchema, meaning: text, purpose: knowledgePurposeSchema })
        .strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("inference"),
      value: z
        .object({
          subject: text,
          proposition: inferenceProposition,
          uncertainty: text,
          evidenceIds: z.array(idSchema).max(20),
          reviewCondition: text,
        })
        .strict(),
    })
    .strict(),
]);
/** Inputs name evidence; only the API assigns verified source classifications. */
export const knowledgeEvidenceSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("statement"),
      wording: text,
      sessionRef: text.optional(),
      messageRef: text.optional(),
    })
    .strict(),
  z.object({ type: z.literal("observation"), reference: text }).strict(),
  z
    .object({
      type: z.literal("domain_record"),
      domain: z.enum(["knowledge", "goals"]),
      id: idSchema,
      revision: z.int().positive(),
    })
    .strict(),
  z.object({ type: z.literal("signed_inbound_message"), id: idSchema }).strict(),
]);
export const knowledgeSourceSchema = z
  .object({
    id: idSchema,
    classification: z.enum([
      "owner_statement",
      "agent_recorded_statement",
      "agent_observation",
      "domain_record",
      "signed_inbound_message",
    ]),
    evidence: knowledgeEvidenceSchema,
    actorType: z.enum(["user", "agent"]),
    actorId: idSchema,
    availability: z.literal("unavailable").optional(),
  })
  .strict();
export type KnowledgeSource = z.infer<typeof knowledgeSourceSchema>;
export const knowledgeValiditySchema = z
  .object({ validFrom: isoDateTimeSchema.nullable(), validUntil: isoDateTimeSchema.nullable() })
  .strict()
  .refine(
    ({ validFrom, validUntil }) =>
      !validFrom || !validUntil || Date.parse(validFrom) < Date.parse(validUntil),
    { path: ["validUntil"], message: "Validity must end after it begins." },
  );

export const knowledgeWriteContentSchema = knowledgeContentSchema.refine(
  (content) =>
    new TextEncoder().encode(JSON.stringify(content.value)).byteLength <= knowledgeValueMaxBytes,
  { path: ["value"], message: "Knowledge value exceeds 8 KiB." },
);
export const knowledgeEvidenceListSchema = z.array(knowledgeEvidenceSchema).max(20);
export const knowledgeRelatedIdsSchema = z
  .array(idSchema)
  .max(20)
  .refine((ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length, {
    message: "Relationships must be unique.",
  });
export const knowledgeSensitivitySchema = z.enum(["standard", "sensitive"]);
export const knowledgeAgentAccessSchema = z.enum(["allowed", "blocked"]);
export type KnowledgeAgentAccess = z.infer<typeof knowledgeAgentAccessSchema>;
export const knowledgePurposesSchema = z.array(knowledgePurposeSchema).min(1).max(6);
export const knowledgeMutationInputSchema = z
  .object({
    content: knowledgeWriteContentSchema,
    scope: knowledgeScopeSchema,
    sensitivity: knowledgeSensitivitySchema.default("standard"),
    /** A relevance hint, never an access check. Omitted means every purpose. */
    purposes: knowledgePurposesSchema.optional(),
    /** Lasting preferences, standing constraints and identity-level facts load at session start. */
    core: z.boolean().default(false),
    /** 1–8 tags. Reuse tags from the index; the API files aliases and plurals under them. */
    tags: knowledgeTagsInputSchema,
    evidence: knowledgeEvidenceListSchema.default([]),
    relatedRecordIds: knowledgeRelatedIdsSchema.default([]),
    validity: knowledgeValiditySchema.optional(),
    mutationKey: z.uuid(),
  })
  .strict();
/** What a caller sends; defaults apply when the API parses it. */
export type KnowledgeMutationInput = z.input<typeof knowledgeMutationInputSchema>;
export type KnowledgeMutation = z.output<typeof knowledgeMutationInputSchema>;

/** Stored revisions keep the `kind` tag so earlier acceptance records still parse. */
export const knowledgeAcceptanceSchema = z
  .object({
    kind: z.literal("owner"),
    actorId: idSchema,
    acceptedAt: isoDateTimeSchema,
    evidenceIds: z.array(idSchema).max(20),
  })
  .strict();
export const knowledgeOriginSchema = z.enum(["stated", "inferred"]);
export const knowledgeRevisionMetadataSchema = z
  .object({
    schemaVersion: z.literal(1),
    origin: knowledgeOriginSchema,
    acceptance: knowledgeAcceptanceSchema.nullable(),
    generatedInference: z.boolean(),
    supersededBy: idSchema.nullable(),
    disputedBy: z.enum(["user", "agent"]).nullable(),
    inheritedRecordIds: z.array(idSchema),
    inheritedSourceIds: z.array(idSchema),
  })
  .strict();
export type KnowledgeRevisionMetadata = z.infer<typeof knowledgeRevisionMetadataSchema>;

export const knowledgeStatusSchema = z.enum([
  "proposed",
  "active",
  "disputed",
  "superseded",
  "archived",
  "expired",
]);
export type KnowledgeStatus = z.infer<typeof knowledgeStatusSchema>;

export const knowledgeRecordSnapshotSchema = z
  .object({
    id: idSchema,
    author: z.object({ actorId: idSchema, actorType: z.enum(["user", "agent"]) }).strict(),
    requiredReadScopes: z.array(accessScopeSchema),
    validFrom: isoDateTimeSchema.nullable(),
    validUntil: isoDateTimeSchema.nullable(),
    reviewAt: isoDateTimeSchema.nullable(),
    schemaVersion: z.literal(1),
    content: knowledgeContentSchema,
    scope: knowledgeScopeSchema,
    sensitivity: z.enum(["standard", "sensitive"]),
    purposes: z.array(knowledgePurposeSchema),
    confidence: z.number().min(0).max(1),
    status: knowledgeStatusSchema,
    revision: z.int().positive(),
    sources: z.array(knowledgeSourceSchema).max(20),
    relatedRecordIds: z.array(idSchema).max(20),
    createdAt: isoDateTimeSchema,
  })
  .strict();
export type KnowledgeRecordSnapshot = z.infer<typeof knowledgeRecordSnapshotSchema>;
export const knowledgeRecordSchema = knowledgeRecordSnapshotSchema.extend({
  origin: knowledgeOriginSchema,
  acceptance: knowledgeAcceptanceSchema.nullable(),
  claimKey: z.string().nullable(),
  conflictRecordIds: z.array(idSchema),
  evidenceAvailable: z.boolean(),
  /** The latest content was written by the person in the app, or the person confirmed it. */
  ownerHeld: z.boolean(),
  /** `blocked` hides the record from every agent read; only the person may change it. */
  agentAccess: knowledgeAgentAccessSchema,
  core: z.boolean(),
  /** Canonical tag names, sorted. Merges change them without a new revision. */
  tags: z.array(z.string()),
  lastConfirmedAt: isoDateTimeSchema.nullable(),
  supersededBy: idSchema.nullable(),
  /** Set only on records in the owner's Trash; agents never receive a trashed record. */
  trashedAt: isoDateTimeSchema.nullable(),
  /** The record whose trash action moved this one; restore and delete now act on that group. */
  trashGroupId: idSchema.nullable(),
});
export type KnowledgeRecord = z.infer<typeof knowledgeRecordSchema>;
/** What the owner reads for a purged record ID: a content-free tombstone. */
export const knowledgeForgottenRecordSchema = z
  .object({
    id: idSchema,
    state: z.literal("forgotten"),
    trashedAt: isoDateTimeSchema,
    purgedAt: isoDateTimeSchema,
  })
  .strict();
export type KnowledgeForgottenRecord = z.infer<typeof knowledgeForgottenRecordSchema>;
export const knowledgeReadInputSchema = z
  .object({ id: idSchema, purpose: knowledgePurposeSchema.optional() })
  .strict();
export type KnowledgeReadInput = z.infer<typeof knowledgeReadInputSchema>;
export const knowledgeReadResultSchema = z.union([
  z.strictObject({ record: knowledgeRecordSchema }),
  knowledgeForgottenRecordSchema,
]);
export type KnowledgeReadResult = z.infer<typeof knowledgeReadResultSchema>;
export const knowledgeReceiptSchema = z
  .object({
    receiptId: idSchema,
    recordId: idSchema,
    outcome: z.literal("readable"),
    record: knowledgeRecordSchema,
  })
  .strict();
export type KnowledgeReceipt = z.infer<typeof knowledgeReceiptSchema>;
