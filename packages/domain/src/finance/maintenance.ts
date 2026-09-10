import { z } from "zod";
import { idSchema } from "../common.js";
import { financeInteractionQuestionSchema } from "./common.js";

export const financeMaintenanceScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("all_outstanding") }),
  z.object({ accountIds: z.array(idSchema).min(1).max(100), type: z.literal("accounts") }),
  z.object({ from: z.iso.date(), type: z.literal("since") }),
]);
export type FinanceMaintenanceScope = z.infer<typeof financeMaintenanceScopeSchema>;

export const financeMaintenanceJudgmentSchema = z.discriminatedUnion("type", [
  z.object({
    categoryId: idSchema,
    confidence: z.number().min(0).max(1),
    meaning: z.string().trim().min(1).max(500),
    rationale: z.string().trim().min(1).max(1_000),
    transactionId: idSchema,
    type: z.literal("classify_transaction"),
  }),
  z.object({
    confidence: z.number().min(0).max(1),
    rationale: z.string().trim().min(1).max(1_000),
    relationship: z.enum(["transfer", "reimbursement", "refund", "reversal", "duplicate"]),
    transactionIds: z.array(idSchema).min(2).max(20),
    type: z.literal("link_transactions"),
  }),
  z.object({
    confidence: z.number().min(0).max(1),
    questionReason: z.string().trim().min(1).max(1_000),
    transactionId: idSchema,
    type: z.literal("needs_user_review"),
  }),
]);
export type FinanceMaintenanceJudgment = z.infer<typeof financeMaintenanceJudgmentSchema>;

export const financeAuditFindingInputSchema = z.object({
  economicEventId: idSchema,
  evidence: z.record(z.string(), z.unknown()),
  impactAmount: z.number().finite().nonnegative(),
  rationale: z.string().trim().min(1).max(2_000),
  reason: z.enum([
    "category_ambiguity",
    "possible_duplicate",
    "reimbursement",
    "unusual_amount",
    "budget_variance",
  ]),
});
export type FinanceAuditFindingInput = z.infer<typeof financeAuditFindingInputSchema>;

export const financeMaintenanceInputSchema = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("start"),
      scope: financeMaintenanceScopeSchema.default({ type: "all_outstanding" }),
    })
    .strict(),
  z
    .object({
      expectedVersion: z.number().int().positive(),
      idempotencyKey: z.string().trim().min(1).max(200),
      judgments: z.array(financeMaintenanceJudgmentSchema).min(1).max(100),
      operation: z.literal("submit_judgments"),
      runId: idSchema,
    })
    .strict(),
  z
    .object({
      expectedVersion: z.number().int().positive(),
      findings: z.array(financeAuditFindingInputSchema).max(100),
      idempotencyKey: z.string().trim().min(1).max(200),
      operation: z.literal("submit_audit"),
      runId: idSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("resume"),
      runId: idSchema,
    })
    .strict(),
]);
export type FinanceMaintenanceInput = z.infer<typeof financeMaintenanceInputSchema>;

export const financeMaintenanceStageSchema = z.enum([
  "deterministic_processing",
  "agent_reasoning",
  "reconciliation",
  "agent_audit",
  "settled",
  "failed",
]);
export type FinanceMaintenanceStage = z.infer<typeof financeMaintenanceStageSchema>;

export const financeReasoningItemSchema = z.object({
  accountId: idSchema,
  amount: z.number().finite(),
  budgetContext: z.record(z.string(), z.unknown()),
  candidateRelationships: z.array(z.record(z.string(), z.unknown())),
  categoryChoices: z.array(z.object({ id: idSchema, name: z.string().min(1) })),
  date: z.iso.date(),
  existingPreferences: z.array(z.string().min(1).max(1_000)),
  merchant: z.string().min(1).max(240),
  transactionId: idSchema,
});
export type FinanceReasoningItem = z.infer<typeof financeReasoningItemSchema>;

export const financeMaintenancePayloadSchema = z.object({
  auditContext: z.record(z.string(), z.unknown()).nullable(),
  reasoningBatch: z.array(financeReasoningItemSchema),
  reviewQuestion: financeInteractionQuestionSchema.nullable(),
  playbookVersion: z.literal("1.0.0").default("1.0.0"),
  runId: idSchema,
  stage: financeMaintenanceStageSchema,
  version: z.number().int().positive(),
});
export type FinanceMaintenancePayload = z.infer<typeof financeMaintenancePayloadSchema>;

export const financeSetupInputSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("start") }),
  z.object({
    answer: z.string().trim().min(1).max(10_000),
    expectedVersion: z.number().int().positive(),
    idempotencyKey: z.string().trim().min(1).max(200),
    operation: z.literal("answer"),
    questionId: z.string().min(1).max(240),
    sessionId: idSchema,
  }),
  z.object({
    approvalSource: z.enum(["user_instruction", "agent_self_approval"]),
    budgetVersionId: idSchema,
    expectedVersion: z.number().int().positive(),
    idempotencyKey: z.string().trim().min(1).max(200),
    operation: z.literal("approve_budget"),
    sessionId: idSchema,
  }),
  z.object({ operation: z.literal("resume"), sessionId: idSchema }),
]);
export type FinanceSetupInput = z.infer<typeof financeSetupInputSchema>;

export const financeSetupPayloadSchema = z.object({
  budgetVersionId: idSchema.nullable(),
  maintenanceRunId: idSchema.nullable(),
  question: financeInteractionQuestionSchema.nullable(),
  sessionId: idSchema,
  stage: z.enum([
    "collecting_profile",
    "budget_proposal",
    "budget_approval",
    "initial_maintenance",
    "settled",
  ]),
  version: z.number().int().positive(),
});
export type FinanceSetupPayload = z.infer<typeof financeSetupPayloadSchema>;
