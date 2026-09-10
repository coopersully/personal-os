import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "../common.js";
import { financePresentationSchema } from "./presentation.js";

export const financeMoneySchema = z.number().finite().min(-100_000_000).max(100_000_000);
export const financePositiveMoneySchema = financeMoneySchema.nonnegative();

export const financeActorTypeSchema = z.enum([
  "user",
  "agent",
  "deterministic_rule",
  "provider",
  "import",
  "system",
]);
export type FinanceActorType = z.infer<typeof financeActorTypeSchema>;

export const financeProvenanceSchema = z.object({
  actorId: z.string().min(1).max(240).nullable(),
  actorType: financeActorTypeSchema,
  confidence: z.number().min(0).max(1).nullable(),
  evidence: z.record(z.string(), z.unknown()),
  maintenanceRunId: idSchema.nullable(),
  observedAt: isoDateTimeSchema,
  requestId: z.string().min(1).max(240).nullable(),
  sourceId: z.string().min(1).max(500).nullable(),
});
export type FinanceProvenance = z.infer<typeof financeProvenanceSchema>;

export const financeMutationMetaSchema = z.object({
  expectedVersion: z.number().int().nonnegative().optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
});
export type FinanceMutationMeta = z.infer<typeof financeMutationMetaSchema>;

export const financeOutcomeSchema = z.enum([
  "completed",
  "work_remaining",
  "user_input_required",
  "external_action_required",
  "failed",
]);
export type FinanceOutcome = z.infer<typeof financeOutcomeSchema>;

export const financeInteractionQuestionSchema = z.object({
  answerType: z.string().min(1).max(120),
  id: z.string().min(1).max(240),
  prompt: z.string().trim().min(1).max(1_000),
});
export type FinanceInteractionQuestion = z.infer<typeof financeInteractionQuestionSchema>;

export const financeCommunicationSchema = z.object({
  headline: z.string().trim().min(1).max(500),
  nextQuestion: financeInteractionQuestionSchema.optional(),
  optionalDetails: z.array(z.string().trim().min(1).max(2_000)).max(50),
  requiredDisclosures: z
    .array(
      z.object({
        importance: z.enum(["critical", "important"]),
        message: z.string().trim().min(1).max(2_000),
      }),
    )
    .max(20),
});
export type FinanceCommunication = z.infer<typeof financeCommunicationSchema>;

export const financeChangeSchema = z.object({
  affectedEntityId: z.string().min(1).max(240),
  description: z.string().trim().min(1).max(1_000),
  reversible: z.boolean(),
  type: z.string().min(1).max(120),
});
export type FinanceChange = z.infer<typeof financeChangeSchema>;

export const financeRemainingWorkSchema = z.object({
  categories: z.array(z.string().min(1).max(120)).max(50),
  count: z.number().int().nonnegative(),
});

export const financeNextActionSchema = z.object({
  arguments: z.record(z.string(), z.unknown()),
  reason: z.string().trim().min(1).max(1_000),
  tool: z.string().min(1).max(120),
});
export type FinanceNextAction = z.infer<typeof financeNextActionSchema>;

export const financeDiagnosticIssueSchema = z.object({
  affectedWork: z.array(z.string().min(1).max(500)).max(100),
  code: z.string().min(1).max(120),
  plainLanguage: z.string().trim().min(1).max(2_000),
  remedy: z.string().trim().min(1).max(2_000),
  retryable: z.boolean(),
  scope: z.enum(["account", "transaction", "budget", "profile", "system"]),
  unaffectedWork: z.array(z.string().min(1).max(500)).max(100),
});
export type FinanceDiagnosticIssue = z.infer<typeof financeDiagnosticIssueSchema>;

export const financeDiagnosticsSchema = z.object({
  issues: z.array(financeDiagnosticIssueSchema).max(100),
});

export const financeToolResultSchema = z.object({
  changes: z.array(financeChangeSchema),
  communication: financeCommunicationSchema,
  data: z.unknown(),
  diagnostics: financeDiagnosticsSchema.optional(),
  nextAction: financeNextActionSchema.optional(),
  outcome: financeOutcomeSchema,
  presentation: financePresentationSchema.optional(),
  remainingWork: financeRemainingWorkSchema,
  schemaVersion: z.literal(1),
});

type FinanceToolResultBase = z.infer<typeof financeToolResultSchema>;
export type FinanceToolResult<T = unknown> = Omit<FinanceToolResultBase, "data"> & {
  data: T;
};

export function financeToolResultSchemaFor<T extends z.ZodType>(dataSchema: T) {
  return financeToolResultSchema.extend({ data: dataSchema });
}
