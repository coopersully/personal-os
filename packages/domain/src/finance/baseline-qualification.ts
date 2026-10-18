import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "../common.js";
import { financeMonthSchema } from "./budget.js";

const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const uniqueAccountsSchema = z
  .array(idSchema)
  .min(1)
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, "Include each budget account only once.");
const timezoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Choose a valid IANA timezone.");
export const financeBudgetBaselineQualificationQuerySchema = z.object({
  month: financeMonthSchema,
});
export const prepareFinanceBudgetBaselineQualificationInputSchema = z
  .object({
    accountIds: uniqueAccountsSchema,
    budgetVersionId: idSchema,
    currency: currencySchema,
    idempotencyKey: z.string().min(1).max(200),
    month: financeMonthSchema,
    timezone: timezoneSchema,
  })
  .strict();
export const confirmFinanceBudgetBaselineQualificationInputSchema = z
  .object({
    reviewId: idSchema,
    expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    idempotencyKey: z.string().min(1).max(200),
  })
  .strict();
export const financeBudgetBaselineSnapshotSchema = z
  .object({
    accountIds: uniqueAccountsSchema,
    allocations: z
      .array(
        z
          .object({
            key: z.string().min(1),
            categoryId: idSchema.nullable(),
            legacyCategory: z.string().nullable(),
            label: z.string().min(1),
            amountCents: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
    budgetVersionId: idSchema,
    budgetVersion: z.number().int().positive(),
    planId: idSchema,
    sourceBaselineId: idSchema.nullable(),
    currency: currencySchema,
    month: financeMonthSchema,
    period: z
      .object({ from: z.iso.date(), through: z.iso.date(), timezone: timezoneSchema })
      .strict(),
    originalApproval: z
      .object({
        approvedAt: isoDateTimeSchema.nullable(),
        actorId: z.string().nullable(),
        actorType: z.enum(["agent", "system", "user"]).nullable(),
      })
      .strict(),
  })
  .strict();
export const financeBudgetBaselineReviewSchema = z
  .object({
    id: idSchema,
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    snapshot: financeBudgetBaselineSnapshotSchema,
  })
  .strict();
export const financeBudgetBaselineQualificationSchema = financeBudgetBaselineSnapshotSchema
  .extend({
    id: idSchema,
    revision: z.literal(1),
    confirmedAt: isoDateTimeSchema,
    confirmedByActorId: z.string().min(1),
    qualificationKind: z.enum(["current", "retrospective"]),
  })
  .strict();
export const financeBudgetBaselineQualificationReadSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("qualified"),
      qualification: financeBudgetBaselineQualificationSchema,
    })
    .strict(),
  z
    .object({
      state: z.literal("unavailable"),
      reason: z.enum([
        "qualification_required",
        "baseline_missing",
        "baseline_incomplete",
        "scope_unavailable",
      ]),
      qualificationRequired: z.literal(true),
      candidates: z
        .array(
          z
            .object({
              budgetVersionId: idSchema,
              planId: idSchema,
              budgetVersion: z.number().int().positive(),
              approvedAt: isoDateTimeSchema,
              originalActorType: z.enum(["user", "agent", "system"]).nullable(),
              period: z
                .object({ from: z.iso.date(), through: z.iso.date(), timezone: timezoneSchema })
                .nullable(),
            })
            .strict(),
        )
        .max(100)
        .default([]),
    })
    .strict(),
]);
export type PrepareFinanceBudgetBaselineQualificationInput = z.infer<
  typeof prepareFinanceBudgetBaselineQualificationInputSchema
>;
export type ConfirmFinanceBudgetBaselineQualificationInput = z.infer<
  typeof confirmFinanceBudgetBaselineQualificationInputSchema
>;
export type FinanceBudgetBaselineSnapshot = z.infer<typeof financeBudgetBaselineSnapshotSchema>;
export type FinanceBudgetBaselineReview = z.infer<typeof financeBudgetBaselineReviewSchema>;
export type FinanceBudgetBaselineQualification = z.infer<
  typeof financeBudgetBaselineQualificationSchema
>;
export type FinanceBudgetBaselineQualificationRead = z.infer<
  typeof financeBudgetBaselineQualificationReadSchema
>;
