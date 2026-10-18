import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "../common.js";
import { financeActualRevisionSchema } from "./occurrence-match.js";
import type { PaydayProjection } from "./payday-projection.js";
import {
  financePlanningEvidenceCentsSchema,
  financePlanningEvidenceCurrencySchema,
} from "./planning-evidence.js";
import {
  type FinanceRecurringOccurrencesView,
  financeRecurringOccurrencesQuerySchema,
} from "./recurring-schedule.js";

export const financeBalanceReflectionSchema = z
  .object({
    transactionId: idSchema,
    transactionRevision: financeActualRevisionSchema,
    reflection: z.enum(["included", "not_included"]),
  })
  .strict();
const fields = {
  accountId: idSchema,
  kind: z.enum(["current", "available"]),
  amountCents: z.number().int().min(-10_000_000_000).max(10_000_000_000),
  currencyCode: financePlanningEvidenceCurrencySchema,
  asOf: isoDateTimeSchema,
  validUntil: isoDateTimeSchema,
  protectedFloorCents: financePlanningEvidenceCentsSchema.nullable(),
  reflections: z.array(financeBalanceReflectionSchema).max(1000),
};
function dates(
  value: { asOf: string; validUntil: string; reflections: Array<{ transactionId: string }> },
  context: z.RefinementCtx,
) {
  if (Date.parse(value.validUntil) < Date.parse(value.asOf))
    context.addIssue({
      code: "custom",
      path: ["validUntil"],
      message: "Validity must follow the balance statement time.",
    });
  if (
    new Set(value.reflections.map((entry) => entry.transactionId)).size !== value.reflections.length
  )
    context.addIssue({
      code: "custom",
      path: ["reflections"],
      message: "State each transaction's reflection once.",
    });
}
export const confirmFinanceBalanceBasisInputSchema = z
  .object({
    ...fields,
    expectedAccountRevision: financeActualRevisionSchema,
    expectedBasisRevision: z.number().int().min(0).max(2_147_483_646),
    idempotencyKey: z.string().trim().min(1).max(200),
  })
  .strict()
  .superRefine(dates);
export type ConfirmFinanceBalanceBasisInput = z.infer<typeof confirmFinanceBalanceBasisInputSchema>;
export const financeBalanceBasisSchema = z
  .object({
    ...fields,
    id: idSchema,
    basisRevision: z.number().int().positive(),
    accountRevision: financeActualRevisionSchema,
    actorUserId: idSchema,
    recordedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine(dates);
export type FinanceBalanceBasis = z.infer<typeof financeBalanceBasisSchema>;
export const financeCashflowProjectionQuerySchema =
  financeRecurringOccurrencesQuerySchema.safeExtend({
    selectedIncomeStreamId: idSchema.nullable(),
  });
export type FinanceCashflowProjectionQuery = z.infer<typeof financeCashflowProjectionQuerySchema>;
export type FinanceCashflowProjectionView = {
  schedule: FinanceRecurringOccurrencesView;
  projection:
    | PaydayProjection
    | {
        status: "unavailable";
        reasons: Array<{
          code:
            | "balance_basis_unavailable"
            | "actual_review_required"
            | "unconfirmed_schedule"
            | "unknown_amount";
          evidenceId: string | null;
        }>;
      };
};
