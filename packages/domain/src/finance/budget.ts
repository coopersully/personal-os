import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "../common.js";
import { financeMutationMetaSchema, financePositiveMoneySchema } from "./common.js";

export const financeMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const financeBudgetResourceSchema = z.object({
  amount: financePositiveMoneySchema,
  description: z.string().trim().min(1).max(500).optional(),
  key: z.string().trim().min(1).max(120),
  kind: z.enum(["income", "reserve_draw", "borrowing", "other"]),
  sourceId: idSchema.optional(),
});
export type FinanceBudgetResource = z.infer<typeof financeBudgetResourceSchema>;

const allocationBase = z.object({
  amount: financePositiveMoneySchema,
  description: z.string().trim().min(1).max(500).optional(),
  key: z.string().trim().min(1).max(120),
});

export const financeBudgetAllocationSchema = z.discriminatedUnion("kind", [
  allocationBase.extend({ categoryId: idSchema, kind: z.literal("spending") }),
  allocationBase.extend({ goalId: idSchema.optional(), kind: z.literal("savings") }),
  allocationBase.extend({ accountId: idSchema, kind: z.literal("debt") }),
  allocationBase.extend({ goalId: idSchema, kind: z.literal("goal") }),
  allocationBase.extend({ kind: z.literal("buffer") }),
]);
export type FinanceBudgetAllocation = z.infer<typeof financeBudgetAllocationSchema>;

function roundCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export const financeBudgetVersionSchema = z
  .object({
    allocatedTotal: financePositiveMoneySchema,
    allocations: z.array(financeBudgetAllocationSchema).max(500),
    approvedAt: isoDateTimeSchema.nullable(),
    assumptions: z.array(z.string().trim().min(1).max(1_000)).max(100),
    balanceDelta: z.number().finite(),
    createdAt: isoDateTimeSchema,
    effectiveFrom: financeMonthSchema,
    expectedResources: financePositiveMoneySchema,
    id: idSchema,
    planId: idSchema,
    rationale: z.string().trim().min(1).max(4_000),
    resources: z.array(financeBudgetResourceSchema).min(1).max(100),
    status: z.enum(["incomplete", "proposed", "active", "retired"]),
    version: z.number().int().positive(),
  })
  .superRefine((value, context) => {
    const resourceTotal = roundCents(
      value.resources.reduce((total, resource) => total + resource.amount, 0),
    );
    const allocationTotal = roundCents(
      value.allocations.reduce((total, allocation) => total + allocation.amount, 0),
    );
    const balances =
      resourceTotal === roundCents(value.expectedResources) &&
      allocationTotal === roundCents(value.allocatedTotal) &&
      roundCents(resourceTotal - allocationTotal) === roundCents(value.balanceDelta) &&
      roundCents(value.balanceDelta) === 0;

    if (!balances) {
      context.addIssue({
        code: "custom",
        message: "Budget resources and allocations must balance to the cent.",
        path: ["balanceDelta"],
      });
    }
  });
export type FinanceBudgetVersion = z.infer<typeof financeBudgetVersionSchema>;

export const createFinanceBudgetVersionInputSchema = z
  .object({
    allocations: z.array(financeBudgetAllocationSchema).min(1).max(500),
    assumptions: z.array(z.string().trim().min(1).max(1_000)).max(100),
    effectiveFrom: financeMonthSchema,
    name: z.string().trim().min(1).max(160).default("Monthly plan"),
    rationale: z.string().trim().min(1).max(4_000),
    resources: z.array(financeBudgetResourceSchema).min(1).max(100),
  })
  .and(financeMutationMetaSchema);
export type CreateFinanceBudgetVersionInput = z.infer<typeof createFinanceBudgetVersionInputSchema>;

export const reviseFinanceBudgetInputSchema = createFinanceBudgetVersionInputSchema.and(
  z.object({
    planId: idSchema,
    expectedVersion: z.number().int().positive(),
  }),
);
export type ReviseFinanceBudgetInput = z.infer<typeof reviseFinanceBudgetInputSchema>;

export const approveFinanceBudgetInputSchema = financeMutationMetaSchema.and(
  z.object({
    approvalSource: z.enum(["user_instruction", "agent_self_approval"]),
    budgetVersionId: idSchema,
    expectedVersion: z.number().int().positive(),
  }),
);
export type ApproveFinanceBudgetInput = z.infer<typeof approveFinanceBudgetInputSchema>;

export const financeGoalSchema = z.object({
  createdAt: isoDateTimeSchema,
  currentAmount: financePositiveMoneySchema,
  deadline: z.iso.date().nullable(),
  id: idSchema,
  name: z.string().trim().min(1).max(240),
  priority: z.enum(["low", "medium", "high"]),
  status: z.enum(["active", "completed", "paused", "removed"]),
  targetAmount: financePositiveMoneySchema,
  updatedAt: isoDateTimeSchema,
  version: z.number().int().positive(),
});
export type FinanceGoal = z.infer<typeof financeGoalSchema>;

export const manageFinanceGoalInputSchema = z.discriminatedUnion("operation", [
  z.object({
    deadline: z.iso.date().nullable(),
    idempotencyKey: z.string().min(1).max(200),
    name: z.string().trim().min(1).max(240),
    operation: z.literal("create"),
    priority: z.enum(["low", "medium", "high"]),
    targetAmount: financePositiveMoneySchema,
  }),
  z.object({
    changes: z
      .object({
        deadline: z.iso.date().nullable().optional(),
        name: z.string().trim().min(1).max(240).optional(),
        priority: z.enum(["low", "medium", "high"]).optional(),
        targetAmount: financePositiveMoneySchema.optional(),
      })
      .refine((changes) => Object.keys(changes).length > 0, "Provide at least one goal change."),
    expectedVersion: z.number().int().positive(),
    goalId: idSchema,
    idempotencyKey: z.string().min(1).max(200),
    operation: z.literal("update"),
  }),
  z.object({
    expectedVersion: z.number().int().positive(),
    goalId: idSchema,
    idempotencyKey: z.string().min(1).max(200),
    operation: z.enum(["complete", "pause", "resume", "remove"]),
  }),
]);
export type ManageFinanceGoalInput = z.infer<typeof manageFinanceGoalInputSchema>;
