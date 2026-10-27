import { z } from "zod";
import { accessScopeSchema } from "./auth.js";
import { idSchema, isoDateTimeSchema } from "./common.js";

// PostgreSQL JSONB rejects NUL and unpaired UTF-16 surrogates. Validate before
// persistence rather than replacing or truncating accepted personal knowledge.
const storableText = (value: string) => !/[\u0000\uD800-\uDFFF]/u.test(value);
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
  })
  .strict();
export type KnowledgeSource = z.infer<typeof knowledgeSourceSchema>;
export const knowledgeMutationInputSchema = z
  .object({
    content: knowledgeContentSchema,
    scope: knowledgeScopeSchema,
    sensitivity: z.enum(["standard", "sensitive"]).default("standard"),
    purposes: z.array(knowledgePurposeSchema).min(1).max(6),
    evidence: z.array(knowledgeEvidenceSchema).max(20).default([]),
    relatedRecordIds: z.array(idSchema).max(20).default([]),
    mutationKey: z.uuid(),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      new TextEncoder().encode(JSON.stringify(input.content.value)).byteLength >
      knowledgeValueMaxBytes
    )
      context.addIssue({
        code: "custom",
        path: ["content", "value"],
        message: "Knowledge value exceeds 8 KiB.",
      });
    if (new Set(input.relatedRecordIds).size !== input.relatedRecordIds.length)
      context.addIssue({
        code: "custom",
        path: ["relatedRecordIds"],
        message: "Relationships must be unique.",
      });
  });
export type KnowledgeMutationInput = z.infer<typeof knowledgeMutationInputSchema>;
export const knowledgeRecordSchema = z
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
    status: z.enum(["proposed", "active", "disputed", "superseded", "expired"]),
    revision: z.int().positive(),
    sources: z.array(knowledgeSourceSchema).max(20),
    relatedRecordIds: z.array(idSchema).max(20),
    createdAt: isoDateTimeSchema,
  })
  .strict();
export type KnowledgeRecord = z.infer<typeof knowledgeRecordSchema>;
export const knowledgeReadInputSchema = z
  .object({ id: idSchema, purpose: knowledgePurposeSchema })
  .strict();
export type KnowledgeReadInput = z.infer<typeof knowledgeReadInputSchema>;
export const knowledgeReceiptSchema = z
  .object({ receiptId: idSchema, record: knowledgeRecordSchema })
  .strict();
export type KnowledgeReceipt = z.infer<typeof knowledgeReceiptSchema>;
