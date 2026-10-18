import { z } from "zod";
import { actorTypeSchema, idSchema, isoDateTimeSchema } from "../common.js";
import {
  financeConversationRecordReferenceSchema,
  financeConversationSequenceSchema,
} from "./conversation.js";

export const financeActivityKindSchema = z.enum(["human_answer_decision", "financial_action"]);
export const financeActivityStatusSchema = z.enum([
  "accepted",
  "proposed",
  "approved",
  "applied",
  "failed",
  "partial",
]);
export const financeActivityTargetSchema = z
  .object({
    kind: z.enum(["chat", "review_case", "transaction", "run"]),
    id: idSchema,
  })
  .strict();
export const financeActivitySourceMessageSchema = z
  .object({
    id: idSchema,
    sequence: financeConversationSequenceSchema,
    text: z.string().min(1).max(10_000),
    createdAt: isoDateTimeSchema,
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    // A missing historical excerpt stays missing. Full immutable source text remains available.
    excerpt: z
      .object({
        start: z.number().int().nonnegative(),
        end: z.number().int().positive(),
        text: z.string().min(1).max(10_000),
      })
      .strict()
      .nullable(),
  })
  .strict();
export const financeActivityChangeSchema = z
  .object({
    id: idSchema,
    recordRef: financeConversationRecordReferenceSchema,
    before: z.record(z.string(), z.unknown()).nullable(),
    after: z.record(z.string(), z.unknown()).nullable(),
    auditEventIds: z.array(idSchema).max(100),
  })
  .strict();
export const financeActivityEntrySchema = z
  .object({
    id: idSchema,
    occurredAt: isoDateTimeSchema,
    kind: financeActivityKindSchema,
    status: financeActivityStatusSchema,
    actor: z.object({ type: actorTypeSchema, id: z.string().min(1).max(240).nullable() }).strict(),
    action: z.string().min(1).max(160),
    explanation: z.string().min(1).max(4000),
    caseId: idSchema.nullable(),
    runId: idSchema.nullable(),
    actionId: z.string().min(1).max(200).nullable(),
    sourceOperationId: idSchema.nullable(),
    auditEventIds: z.array(idSchema).min(1).max(100),
    sourceMessages: z.array(financeActivitySourceMessageSchema).max(100),
    recordRefs: z.array(financeConversationRecordReferenceSchema).max(100),
    changes: z.array(financeActivityChangeSchema).max(100),
    targets: z.array(financeActivityTargetSchema).max(100),
  })
  .strict();
export type FinanceActivityEntry = z.infer<typeof financeActivityEntrySchema>;
export const financeActivityQuerySchema = z
  .object({
    cursor: z.string().min(1).max(3000).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    type: financeActivityKindSchema.optional(),
    actor: actorTypeSchema.optional(),
    recordId: idSchema.optional(),
    from: isoDateTimeSchema.optional(),
    through: isoDateTimeSchema.optional(),
  })
  .strict()
  .refine(
    (query) => !query.from || !query.through || Date.parse(query.from) <= Date.parse(query.through),
    "The date range must be ordered.",
  );
export type FinanceActivityQuery = z.infer<typeof financeActivityQuerySchema>;
export const financeActivityPageSchema = z
  .object({
    entries: z.array(financeActivityEntrySchema).max(100),
    nextCursor: z.string().min(1).max(3000).nullable(),
    capabilities: z
      .object({
        financialActions: z
          .object({
            state: z.literal("unavailable"),
            reason: z.literal("mutation_evidence_not_integrated"),
          })
          .strict(),
        humanDecisions: z.object({ state: z.literal("available") }).strict(),
      })
      .strict(),
    coverage: z
      .object({
        state: z.literal("partial"),
        reasons: z
          .array(
            z.enum([
              "financial_mutation_evidence_not_integrated",
              "historical_decisions_without_causal_message_not_projected",
            ]),
          )
          .min(1)
          .max(2),
      })
      .strict(),
  })
  .strict();
export type FinanceActivityPage = z.infer<typeof financeActivityPageSchema>;
