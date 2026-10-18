import { z } from "zod";
import type { FinanceOccurrenceMatchEvent } from "./occurrence-match.js";
import { idSchema, isoDateTimeSchema } from "../common.js";
import { addLocalDays, localDateToIso, parseLocalDate } from "../time.js";
import {
  financePlanningEvidenceCentsSchema,
  financePlanningEvidenceCurrencySchema,
} from "./planning-evidence.js";

export const financeScheduleCadenceSchema = z.enum([
  "weekly",
  "biweekly",
  "semimonthly",
  "monthly",
  "quarterly",
  "yearly",
  "irregular",
]);
export const financeScheduleSourceSchema = z
  .object({ kind: z.enum(["income", "obligation"]), id: idSchema })
  .strict();
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
  }, "Choose a supported timezone.");
const statementSchema = z
  .object({
    source: financeScheduleSourceSchema,
    accountId: idSchema.nullable(),
    cadence: financeScheduleCadenceSchema,
    timezone: timezoneSchema,
    anchorLocalDate: z.iso.date(),
    effectiveFrom: z.iso.date(),
    semimonthlyDays: z
      .tuple([z.number().int().min(1).max(31), z.number().int().min(1).max(31)])
      .nullable(),
    amountBasis: z.enum(["fixed", "variable"]),
    amountCents: financePlanningEvidenceCentsSchema.nullable(),
    currencyCode: financePlanningEvidenceCurrencySchema,
  })
  .strict();
function validateStatement(value: z.infer<typeof statementSchema>, context: z.RefinementCtx) {
  if (value.amountBasis === "fixed" && value.amountCents === null)
    context.addIssue({
      code: "custom",
      path: ["amountCents"],
      message: "A fixed schedule requires an explicit amount.",
    });
  if (
    value.cadence === "semimonthly"
      ? value.semimonthlyDays === null || value.semimonthlyDays[0] === value.semimonthlyDays[1]
      : value.semimonthlyDays !== null
  )
    context.addIssue({
      code: "custom",
      path: ["semimonthlyDays"],
      message: "Choose two distinct days only for a semimonthly schedule.",
    });
}
export const confirmFinanceRecurringScheduleInputSchema = statementSchema
  .extend({
    expectedSourceRevision: z.number().int().positive().max(2_147_483_646),
    supersedesId: idSchema.nullable(),
    idempotencyKey: z.string().trim().min(1).max(200),
  })
  .superRefine(validateStatement);
export type ConfirmFinanceRecurringScheduleInput = z.infer<
  typeof confirmFinanceRecurringScheduleInputSchema
>;
export const financeRecurringScheduleSchema = statementSchema
  .extend({
    id: idSchema,
    sourceRevision: z.number().int().positive(),
    supersedesId: idSchema.nullable(),
    actorUserId: idSchema,
    recordedAt: isoDateTimeSchema,
  })
  .superRefine(validateStatement);
export type FinanceRecurringSchedule = z.infer<typeof financeRecurringScheduleSchema>;
export const financeRecurringOccurrencesQuerySchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    accountIds: z.array(idSchema).max(100).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.from > value.to ||
      value.to > localDateToIso(addLocalDays(parseLocalDate(value.from), 365))
    )
      context.addIssue({ code: "custom", message: "Choose between one and 366 calendar dates." });
  });
export type FinanceRecurringOccurrencesQuery = z.infer<
  typeof financeRecurringOccurrencesQuerySchema
>;

export type FinanceRecurringOccurrence = {
  key: string;
  occurrenceId: string | null;
  scheduleVersionId: string;
  source: z.infer<typeof financeScheduleSourceSchema>;
  sourceRevision: number;
  accountId: string | null;
  displayName: string;
  localDate: string;
  slot: number;
  expectedAmountCents: number | null;
  currencyCode: string;
  amountBasis: "fixed" | "variable";
  certainty: "expected";
  /** False for retained matched/reversed history outside the effective schedule interval. */
  inCurrentSchedule: boolean;
  matchState: "expected" | "partially_matched" | "matched" | "invalidated";
  matchedAmountCents: number;
  remainingExpectedCents: number | null;
  matchIds: string[];
};
export type FinanceRecurringOccurrencesView = {
  from: string;
  to: string;
  occurrences: FinanceRecurringOccurrence[];
  /** Immutable originals and full reversal references for the requested occurrence range. */
  matchEvents: FinanceOccurrenceMatchEvent[];
  unavailableSources: Array<{
    source: z.infer<typeof financeScheduleSourceSchema>;
    reason: "unconfirmed_schedule" | "source_changed" | "irregular_cadence" | "unknown_amount";
  }>;
};
