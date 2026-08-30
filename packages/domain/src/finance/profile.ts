import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "../common.js";
import {
  financeMutationMetaSchema,
  financePositiveMoneySchema,
  financeProvenanceSchema,
} from "./common.js";

export const financeIncomeStabilitySchema = z.enum(["stable", "variable", "seasonal", "unknown"]);

export const financeDebtProfileSchema = z.object({
  accountId: idSchema.nullable(),
  balance: financePositiveMoneySchema,
  interestRate: z.number().finite().min(0).max(100).nullable(),
  minimumMonthlyPayment: financePositiveMoneySchema,
  name: z.string().trim().min(1).max(240),
});

export const financeInsuranceProfileSchema = z.object({
  annualPremium: financePositiveMoneySchema.nullable(),
  coverageAmount: financePositiveMoneySchema.nullable(),
  kind: z.enum(["health", "life", "disability", "property", "liability", "other"]),
  name: z.string().trim().min(1).max(240),
  status: z.enum(["active", "lapsed", "cancelled", "unknown"]),
});

export const financePlanningPreferencesSchema = z.object({
  bufferTarget: financePositiveMoneySchema.nullable(),
  debtPriority: z.enum(["avalanche", "snowball", "minimums", "custom"]).nullable(),
  emergencyReserveMonths: z.number().finite().min(0).max(60).nullable(),
  notes: z.array(z.string().trim().min(1).max(1_000)).max(100),
});

export const financeProfileVersionSchema = z.object({
  createdAt: isoDateTimeSchema,
  debts: z.array(financeDebtProfileSchema).max(100),
  dependents: z.number().int().nonnegative().max(100).nullable(),
  expectedMonthlyTakeHome: financePositiveMoneySchema.nullable(),
  householdSize: z.number().int().positive().max(100).nullable(),
  id: idSchema,
  incomeStability: financeIncomeStabilitySchema,
  insurance: z.array(financeInsuranceProfileSchema).max(100),
  jurisdiction: z.string().trim().min(1).max(120).nullable(),
  liquidReserves: financePositiveMoneySchema.nullable(),
  preferences: financePlanningPreferencesSchema,
  provenance: z.record(z.string(), financeProvenanceSchema),
  userId: idSchema,
  version: z.number().int().positive(),
});
export type FinanceProfileVersion = z.infer<typeof financeProfileVersionSchema>;

export const financialProfileChangesSchema = z
  .object({
    debts: z.array(financeDebtProfileSchema).max(100).optional(),
    dependents: z.number().int().nonnegative().max(100).nullable().optional(),
    expectedMonthlyTakeHome: financePositiveMoneySchema.nullable().optional(),
    householdSize: z.number().int().positive().max(100).nullable().optional(),
    incomeStability: financeIncomeStabilitySchema.optional(),
    insurance: z.array(financeInsuranceProfileSchema).max(100).optional(),
    jurisdiction: z.string().trim().min(1).max(120).nullable().optional(),
    liquidReserves: financePositiveMoneySchema.nullable().optional(),
    preferences: financePlanningPreferencesSchema.optional(),
  })
  .refine((changes) => Object.keys(changes).length > 0, "Provide at least one profile change.");

export const updateFinancialProfileInputSchema = z
  .object({
    changes: financialProfileChangesSchema,
  })
  .and(financeMutationMetaSchema.required({ expectedVersion: true }));
export type UpdateFinancialProfileInput = z.infer<typeof updateFinancialProfileInputSchema>;

export const financeAgentSettingsSchema = z.object({
  reviewBypassEnabled: z.boolean(),
  updatedAt: isoDateTimeSchema,
  userId: idSchema,
  version: z.number().int().positive(),
});
export type FinanceAgentSettings = z.infer<typeof financeAgentSettingsSchema>;

export const updateFinanceAgentSettingsInputSchema = z
  .object({ reviewBypassEnabled: z.boolean() })
  .and(financeMutationMetaSchema.required({ expectedVersion: true }));
export type UpdateFinanceAgentSettingsInput = z.infer<typeof updateFinanceAgentSettingsInputSchema>;
