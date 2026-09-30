import { z } from "zod";
import { idSchema } from "../common.js";
import { maintenanceRunSchema, maintenanceScopeSchema } from "../maintenance.js";
import { financeInteractionQuestionSchema } from "./common.js";
import { financeWorkflowUnavailableSchema } from "./workflow-contracts.js";

/** The only live Finance maintenance entrypoint; historical judgments are evidence only. */
export const financeMaintenanceInputSchema = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("start"),
      scope: maintenanceScopeSchema.default({ type: "all_outstanding" }),
    })
    .strict(),
  z.object({ operation: z.literal("resume"), runId: idSchema }).strict(),
]);
export type FinanceMaintenanceInput = z.infer<typeof financeMaintenanceInputSchema>;

export const financeMaintenanceRecoverySchema = z.object({
  legacyRunId: idSchema,
  state: z.enum(["adopted", "blocked", "historical"]),
  originalScope: z.record(z.string(), z.unknown()),
  originalStage: z.string().min(1).max(100),
  throughDate: z.iso.date().nullable(),
  reason: z.string().min(1).max(1000),
});
export type FinanceMaintenanceRecovery = z.infer<typeof financeMaintenanceRecoverySchema>;

export const financeMaintenanceNextActionSchema = z.discriminatedUnion("tool", [
  z.object({
    tool: z.literal("get_finance_ledger_challenge"),
    arguments: z.object({ challengeId: idSchema }),
    reason: z.string().min(1).max(1000),
  }),
  z.object({
    tool: z.literal("maintain_finances"),
    arguments: z.object({ operation: z.literal("resume"), runId: idSchema }),
    reason: z.string().min(1).max(1000),
  }),
]);
export const financeMaintenancePayloadSchema = z.object({
  run: maintenanceRunSchema.nullable(),
  challengeId: idSchema.nullable(),
  nextAction: financeMaintenanceNextActionSchema.nullable(),
  recovery: financeMaintenanceRecoverySchema.nullable(),
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
    expectedVersion: z.number().int().positive(),
    idempotencyKey: z.string().trim().min(1).max(200),
    operation: z.literal("skip"),
    questionId: z.string().min(1).max(240),
    sessionId: idSchema,
  }),
  z.object({
    approvalSource: z.enum(["user_instruction", "agent_self_approval"]),
    budgetVersionId: idSchema,
    expectedProfileVersionId: idSchema.nullable().optional(),
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
  profileVersionId: idSchema.nullable().optional(),
  position: financeWorkflowUnavailableSchema.optional(),
  maintenanceRunId: idSchema.nullable(),
  canonicalMaintenanceRunId: idSchema.nullable(),
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
