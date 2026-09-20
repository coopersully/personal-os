import { z } from "zod";
import { idSchema } from "../common.js";
import { financeProvenanceSchema } from "./common.js";

const centsSchema = z.number().int().min(0).max(10_000_000_000);
const statedNeedSchema = z
  .object({
    id: idSchema,
    name: z.string().trim().min(1).max(240),
    amountCents: centsSchema.nullable(),
    dueDay: z.number().int().min(1).max(31).nullable(),
    provenance: financeProvenanceSchema,
  })
  .strict();

const statedResourceSchema = statedNeedSchema
  .omit({ dueDay: true })
  .extend({ expectedDate: z.iso.date().nullable() });

/** Stated monthly planning inputs, never an account-position or funding projection. */
export const financeSetupPlanningSchema = z
  .object({
    recurringIncome: z
      .object({
        amountCents: centsSchema.nullable(),
        nextDate: z.iso.date().nullable(),
        provenance: financeProvenanceSchema,
      })
      .strict()
      .nullable()
      .default(null),
    uncertainIncome: z.array(statedResourceSchema).max(100).nullable().default(null),
    exceptionalResources: z.array(statedResourceSchema).max(100).nullable().default(null),
    obligations: z
      .array(statedNeedSchema.extend({ debtAccountId: idSchema.nullable() }))
      .max(100)
      .nullable()
      .default(null),
    contributions: z
      .array(statedNeedSchema.extend({ goalId: idSchema }))
      .max(100)
      .nullable()
      .default(null),
    priorities: z
      .array(
        statedNeedSchema.extend({
          categoryId: idSchema.nullable(),
          protected: z.boolean(),
        }),
      )
      .max(100)
      .nullable()
      .default(null),
  })
  .strict()
  .superRefine((value, context) => {
    const identities = new Set<string>();
    const debtAccounts = new Set<string>();
    const goals = new Set<string>();
    for (const key of [
      "uncertainIncome",
      "exceptionalResources",
      "obligations",
      "contributions",
      "priorities",
    ] as const) {
      for (const [index, item] of (value[key] ?? []).entries()) {
        if (identities.has(item.id))
          context.addIssue({
            code: "custom",
            message: "Each planning item needs a distinct identity.",
            path: [key, index, "id"],
          });
        identities.add(item.id);
        if ("debtAccountId" in item && typeof item.debtAccountId === "string") {
          if (debtAccounts.has(item.debtAccountId))
            context.addIssue({
              code: "custom",
              message: "Reserve a debt minimum only once.",
              path: [key, index, "debtAccountId"],
            });
          debtAccounts.add(item.debtAccountId);
        }
        if ("goalId" in item && typeof item.goalId === "string") {
          if (goals.has(item.goalId))
            context.addIssue({
              code: "custom",
              message: "Plan a goal contribution only once.",
              path: [key, index, "goalId"],
            });
          goals.add(item.goalId);
        }
      }
    }
  });
export type FinanceSetupPlanning = z.infer<typeof financeSetupPlanningSchema>;

const prompts = {
  recurringIncome:
    "What monthly take-home amount can you reliably plan around, and when is your next payment?",
  uncertainIncome:
    "Is there other income that may arrive but is not reliable enough to fund your monthly plan?",
  exceptionalResources:
    "Are there any one-time resources you want to consider separately from recurring income?",
  obligations: "Which bills and debt minimums must this plan cover, and when are they due?",
  contributions: "Which savings goals do you want to contribute to each month, and when?",
  priorities:
    "Which spending priorities should your plan protect, and what monthly amounts do you choose?",
} as const;
type PlanningField = keyof typeof prompts;

export const financeSetupSkippedQuestionSchema = z
  .object({
    questionId: z.enum([
      "planning:recurringIncome",
      "planning:uncertainIncome",
      "planning:exceptionalResources",
      "planning:obligations",
      "planning:contributions",
      "planning:priorities",
    ]),
    profileVersion: z.number().int().nonnegative(),
  })
  .strict();

function unknownFields(planning: FinanceSetupPlanning): PlanningField[] {
  return (Object.keys(prompts) as PlanningField[]).filter((key) => {
    if (key === "recurringIncome")
      return (
        planning.recurringIncome === null ||
        planning.recurringIncome.amountCents === null ||
        planning.recurringIncome.nextDate === null
      );
    if (key === "uncertainIncome" || key === "exceptionalResources")
      return (
        planning[key] === null ||
        planning[key].some((item) => item.amountCents === null || item.expectedDate === null)
      );
    return (
      planning[key] === null ||
      planning[key].some((item) => item.amountCents === null || item.dueDay === null)
    );
  });
}

/** A skip is progress for one displayed revision; it never supplies a missing fact. */
export function nextFinancePlanningQuestion(
  input: FinanceSetupPlanning,
  skipped: z.infer<typeof financeSetupSkippedQuestionSchema>[],
  profileVersion: number,
) {
  const planning = financeSetupPlanningSchema.parse(input);
  z.number().int().nonnegative().parse(profileVersion);
  const validSkips = z.array(financeSetupSkippedQuestionSchema).max(100).parse(skipped);
  const key = unknownFields(planning).find(
    (field) =>
      !validSkips.some(
        (skip) => skip.questionId === `planning:${field}` && skip.profileVersion === profileVersion,
      ),
  );
  return key ? { id: `planning:${key}` as const, prompt: prompts[key] } : null;
}

/** Arithmetic over stated needs only. Qualified position remains a separate dependency. */
export function summarizeFinancePlanning(input: FinanceSetupPlanning) {
  const planning = financeSetupPlanningSchema.parse(input);
  const unknown = unknownFields(planning);
  const recurringFloorCents = planning.recurringIncome?.amountCents ?? null;
  const knownMonthlyNeedsCents = [
    ...(planning.obligations ?? []),
    ...(planning.contributions ?? []),
    ...(planning.priorities ?? []),
  ].reduce((sum, item) => sum + (item.amountCents ?? 0), 0);
  const balanceCents =
    recurringFloorCents !== null && unknown.length === 0
      ? recurringFloorCents - knownMonthlyNeedsCents
      : null;
  return {
    recurringFloorCents,
    knownMonthlyNeedsCents,
    balanceCents,
    deficitCents: balanceCents === null ? null : Math.max(0, -balanceCents),
    unknownFields: unknown,
    requiresPositionEvidence: true as const,
  };
}
