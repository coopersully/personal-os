import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "../common.js";
import {
  financeBudgetPolicyEvaluationSchema,
  financeBudgetPolicyPeriodSchema,
  financeBudgetPolicyPlanSnapshotSchema,
  financeBudgetPolicyRevisionTupleSchema,
  financeBudgetPolicyTermsSchema,
} from "./budget-policy.js";
import { financeMutationMetaSchema } from "./common.js";
import { financeRevisionRefSchema } from "./workflow-contracts.js";

const mutation = { idempotencyKey: financeMutationMetaSchema.shape.idempotencyKey };
export const financeBudgetPolicyHashSchema = z
  .string()
  .length(71)
  .regex(/^sha256:[0-9a-f]{64}$/);
const revision = z.number().int().min(1).max(2_147_483_647);
export const financeBudgetPolicyCapabilitySchema = z
  .object({
    executionAvailable: z.literal(false),
    executionUnavailableReasons: z.tuple([
      z.literal("authority_not_wired"),
      z.literal("position_commit_fence_not_wired"),
    ]),
  })
  .strict();
export const createFinanceBudgetPolicySchema = z
  .object({
    ...mutation,
    planId: idSchema,
    terms: financeBudgetPolicyTermsSchema,
    expectedProfile: financeRevisionRefSchema.nullable(),
    expectedLatestBudget: financeRevisionRefSchema.nullable(),
  })
  .strict();
export const reviseFinanceBudgetPolicySchema = createFinanceBudgetPolicySchema
  .omit({ planId: true })
  .extend({
    expectedLifecycleRevision: revision,
    expectedLatestVersion: revision,
  })
  .strict();
export const financeBudgetPolicyLifecycleSchema = z
  .object({ ...mutation, expectedLifecycleRevision: revision })
  .strict();
export const financeBudgetPolicyListSchema = z
  .object({ limit: z.number().int().min(1).max(100), beforeId: idSchema.optional() })
  .strict();
export const previewFinanceBudgetPolicySchema = z
  .object({
    policyId: idSchema,
    expected: financeBudgetPolicyRevisionTupleSchema,
    candidate: financeBudgetPolicyPlanSnapshotSchema,
  })
  .strict();
export const createFinanceBudgetRevisionProposalSchema = previewFinanceBudgetPolicySchema
  .extend(mutation)
  .strict();
export const saveFinanceBudgetPolicyPreviewSchema = z
  .object({
    ...mutation,
    expected: financeBudgetPolicyRevisionTupleSchema,
    expectedProposalRevision: revision,
    expiresAt: isoDateTimeSchema,
  })
  .strict();
export const designateFinanceBudgetBaselineSchema = z
  .object({
    ...mutation,
    planId: idSchema,
    period: financeBudgetPolicyPeriodSchema,
    budget: financeRevisionRefSchema,
    expectedProfile: financeRevisionRefSchema.nullable(),
    expectedLatestBudget: financeRevisionRefSchema,
  })
  .strict();

export const financeBudgetPolicyVersionRecordSchema = z
  .object({
    id: idSchema,
    version: revision,
    terms: financeBudgetPolicyTermsSchema,
    createdAt: isoDateTimeSchema,
  })
  .strict();
export const financeBudgetPolicyRecordSchema = financeBudgetPolicyCapabilitySchema
  .extend({
    id: idSchema,
    planId: idSchema,
    state: z.enum(["draft", "disabled"]),
    lifecycleRevision: revision,
    latestVersion: financeBudgetPolicyVersionRecordSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();
export const financeBudgetRevisionProposalRecordSchema = financeBudgetPolicyCapabilitySchema
  .extend({
    id: idSchema,
    policyId: idSchema,
    policyVersionId: idSchema,
    state: z.enum(["inactive", "withdrawn"]),
    lifecycleRevision: revision,
    candidate: financeBudgetPolicyPlanSnapshotSchema,
    candidateHash: financeBudgetPolicyHashSchema,
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();
export const financeBudgetPolicyPreviewRecordSchema = financeBudgetPolicyCapabilitySchema
  .extend({
    id: idSchema,
    proposalId: idSchema,
    previewHash: financeBudgetPolicyHashSchema,
    result: financeBudgetPolicyEvaluationSchema,
    expiresAt: isoDateTimeSchema,
    createdAt: isoDateTimeSchema,
    assessment: z
      .object({
        stale: z.boolean(),
        expired: z.boolean(),
        proposalWithdrawn: z.boolean(),
        policyDisabled: z.boolean(),
      })
      .strict(),
  })
  .strict();
export const financeBudgetPeriodBaselineRecordSchema = financeBudgetPolicyCapabilitySchema
  .extend({
    id: idSchema,
    planId: idSchema,
    period: financeBudgetPolicyPeriodSchema,
    budget: financeRevisionRefSchema,
    confirmedAt: isoDateTimeSchema,
  })
  .strict();
export type CreateFinanceBudgetPolicyInput = z.infer<typeof createFinanceBudgetPolicySchema>;
export type ReviseFinanceBudgetPolicyInput = z.infer<typeof reviseFinanceBudgetPolicySchema>;
export type FinanceBudgetPolicyLifecycleInput = z.infer<typeof financeBudgetPolicyLifecycleSchema>;
export type FinanceBudgetPolicyListInput = z.infer<typeof financeBudgetPolicyListSchema>;
export type PreviewFinanceBudgetPolicyInput = z.infer<typeof previewFinanceBudgetPolicySchema>;
export type CreateFinanceBudgetRevisionProposalInput = z.infer<
  typeof createFinanceBudgetRevisionProposalSchema
>;
export type SaveFinanceBudgetPolicyPreviewInput = z.infer<
  typeof saveFinanceBudgetPolicyPreviewSchema
>;
export type DesignateFinanceBudgetBaselineInput = z.infer<
  typeof designateFinanceBudgetBaselineSchema
>;
export type FinanceBudgetPolicyRecord = z.infer<typeof financeBudgetPolicyRecordSchema>;
export type FinanceBudgetRevisionProposalRecord = z.infer<
  typeof financeBudgetRevisionProposalRecordSchema
>;
export type FinanceBudgetPolicyPreviewRecord = z.infer<
  typeof financeBudgetPolicyPreviewRecordSchema
>;
export type FinanceBudgetPeriodBaselineRecord = z.infer<
  typeof financeBudgetPeriodBaselineRecordSchema
>;
