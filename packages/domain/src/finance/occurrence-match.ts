import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "../common.js";
import {
  financePlanningEvidenceCentsSchema,
  financePlanningEvidenceCurrencySchema,
} from "./planning-evidence.js";

export const financeOccurrenceReferenceSchema = z
  .object({
    scheduleVersionId: idSchema,
    localDate: z.iso.date(),
    slot: z.number().int().min(0).max(1),
  })
  .strict();
export const financeActualRevisionSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,18}$/)
  .refine(
    (value) => /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9_223_372_036_854_775_807n,
    "Revision exceeds storage bounds.",
  );
const common = {
  idempotencyKey: z.string().trim().min(1).max(200),
  rationale: z.string().trim().min(1).max(2000),
};
const match = {
  ...common,
  occurrence: financeOccurrenceReferenceSchema,
  transactionId: idSchema,
  expectedTransactionRevision: financeActualRevisionSchema,
  expectedReimbursementRelationshipRevision: financeActualRevisionSchema,
  amountCents: financePlanningEvidenceCentsSchema.min(1),
  currencyCode: financePlanningEvidenceCurrencySchema,
};
export const manageFinanceOccurrenceMatchInputSchema = z.discriminatedUnion("operation", [
  z
    .object({
      ...match,
      operation: z.literal("match_expense"),
      allocationId: idSchema,
      expectedAllocationRevision: z.number().int().positive(),
    })
    .strict(),
  z.object({ ...match, operation: z.literal("match_income") }).strict(),
  z.object({ ...common, operation: z.literal("reverse"), matchId: idSchema }).strict(),
]);
export type ManageFinanceOccurrenceMatchInput = z.infer<
  typeof manageFinanceOccurrenceMatchInputSchema
>;
export const financeOccurrenceMatchEventSchema = z.object({
  id: idSchema,
  occurrenceId: idSchema,
  kind: z.enum(["match", "reverse"]),
  allocationId: idSchema.nullable(),
  incomeTransactionId: idSchema.nullable(),
  amountCents: financePlanningEvidenceCentsSchema.min(1),
  currencyCode: financePlanningEvidenceCurrencySchema,
  allocationRevision: z.number().int().positive().nullable(),
  transactionRevision: financeActualRevisionSchema,
  reimbursementRelationshipRevision: financeActualRevisionSchema.nullable(),
  reversesMatchId: idSchema.nullable(),
  actorUserId: idSchema,
  approvalActor: z
    .object({ type: z.literal("agent"), id: idSchema })
    .strict()
    .optional(),
  recordedAt: isoDateTimeSchema,
  rationale: z.string(),
});
export type FinanceOccurrenceMatchEvent = z.infer<typeof financeOccurrenceMatchEventSchema>;
