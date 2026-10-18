import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "../common.js";
import { financeRecurringObligationSchema } from "../finance.js";

const financeCadenceSchema = financeRecurringObligationSchema.shape.cadence;

/** Storage cents match the bounded planning-input contract; no conversion is implied. */
export const financePlanningEvidenceCentsSchema = z.number().int().min(0).max(10_000_000_000);
const revisionSchema = z.number().int().positive().safe();
const dateSchema = z.iso.date();

/** Reject unknown ISO codes and currencies whose standard minor unit is not two digits. */
export const financePlanningEvidenceCurrencySchema = z.string().refine((currency) => {
  if (!Intl.supportedValuesOf("currency").includes(currency)) return false;
  // Intl defaults to two digits for these ISO units even though their minor unit is undefined.
  if (
    [
      "XAG",
      "XAU",
      "XBA",
      "XBB",
      "XBC",
      "XBD",
      "XDR",
      "XPD",
      "XPT",
      "XSU",
      "XTS",
      "XUA",
      "XXX",
    ].includes(currency)
  )
    return false;
  const format = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions();
  return format.minimumFractionDigits === 2 && format.maximumFractionDigits === 2;
}, "Choose a recognized currency with two minor-unit digits.");

const commonEvidenceShape = {
  evidenceId: idSchema,
  ownerUserId: idSchema,
  actor: z.object({ type: z.literal("user"), userId: idSchema }).strict(),
  provenance: z.literal("explicit_user"),
  currencyCode: financePlanningEvidenceCurrencySchema,
  asOf: dateSchema,
  /** Server receipt time only. This is never a claim of bank/provider freshness. */
  recordedAt: isoDateTimeSchema,
};

export const financeObligationPlanningEvidenceSchema = z
  .object({
    ...commonEvidenceShape,
    kind: z.literal("obligation"),
    sourceId: idSchema,
    sourceRevision: revisionSchema,
    expectedAmountCents: financePlanningEvidenceCentsSchema,
    cadence: financeCadenceSchema,
    accountId: idSchema.nullable(),
    fixedness: z.enum(["fixed", "variable"]),
  })
  .strict();

export const financeGoalPlanningEvidenceSchema = z
  .object({
    ...commonEvidenceShape,
    kind: z.literal("goal"),
    goalId: idSchema,
    /** The resulting goal version after the evidence mutation commits. */
    goalVersion: revisionSchema,
    progressAmountCents: financePlanningEvidenceCentsSchema,
  })
  .strict();

export const financePlanningEvidenceSchema = z.discriminatedUnion("kind", [
  financeObligationPlanningEvidenceSchema,
  financeGoalPlanningEvidenceSchema,
]);
export type FinanceObligationPlanningEvidence = z.infer<
  typeof financeObligationPlanningEvidenceSchema
>;
export type FinanceGoalPlanningEvidence = z.infer<typeof financeGoalPlanningEvidenceSchema>;
export type FinancePlanningEvidence = z.infer<typeof financePlanningEvidenceSchema>;

export type FinanceObligationPlanningSource = {
  kind: "obligation";
  id: string;
  ownerUserId: string;
  revision: number;
  expectedAmountCents: number;
  cadence: z.infer<typeof financeCadenceSchema>;
  accountId: string | null;
  currencyCode: string | null;
  obligationKind: "bill" | "subscription" | "savings";
  status: "active" | "cancelled" | "needs_review" | "paused";
};
export type FinanceGoalPlanningSource = {
  kind: "goal";
  id: string;
  ownerUserId: string;
  version: number;
  progressAmountCents: number | null;
  currencyCode: string | null;
  status: "active" | "completed" | "paused" | "removed";
};
export type FinancePlanningEvidenceUnknownReason =
  | "missing_evidence"
  | "invalid_evidence"
  | "owner_mismatch"
  | "source_mismatch"
  | "source_changed"
  | "ineligible_source"
  | "future_as_of"
  | "currency_mismatch";
export type FinancePlanningEvidenceApplicability =
  | { state: "applicable"; evidence: FinancePlanningEvidence }
  | { state: "unknown"; reason: FinancePlanningEvidenceUnknownReason };

/**
 * Pure applicability only: callers supply authenticated persisted evidence and the current
 * owned source. Matching content never revives an older revision after an A→B→A change.
 * No row, default zero, inferred source flag, or recordedAt alone establishes evidence.
 */
export function financePlanningEvidenceApplicability(input: {
  ownerUserId: string;
  today: string;
  source: FinanceObligationPlanningSource | FinanceGoalPlanningSource;
  evidence: unknown;
}): FinancePlanningEvidenceApplicability {
  idSchema.parse(input.ownerUserId);
  const today = dateSchema.parse(input.today);
  const unknown = (
    reason: FinancePlanningEvidenceUnknownReason,
  ): FinancePlanningEvidenceApplicability => ({
    state: "unknown",
    reason,
  });
  if (input.source.ownerUserId !== input.ownerUserId) return unknown("owner_mismatch");
  if (input.evidence === null || input.evidence === undefined) return unknown("missing_evidence");
  const parsed = financePlanningEvidenceSchema.safeParse(input.evidence);
  if (!parsed.success) return unknown("invalid_evidence");
  const evidence = parsed.data;
  const source = input.source;
  if (evidence.ownerUserId !== input.ownerUserId || evidence.actor.userId !== input.ownerUserId)
    return unknown("owner_mismatch");
  if (source.kind !== evidence.kind) return unknown("source_mismatch");
  if (source.kind === "obligation" && evidence.kind === "obligation") {
    if (source.id !== evidence.sourceId) return unknown("source_mismatch");
    if (!["active", "needs_review"].includes(source.status) || source.obligationKind === "savings")
      return unknown("ineligible_source");
    if (
      source.revision !== evidence.sourceRevision ||
      source.expectedAmountCents !== evidence.expectedAmountCents ||
      source.cadence !== evidence.cadence ||
      source.accountId !== evidence.accountId
    )
      return unknown("source_changed");
  }
  if (source.kind === "goal" && evidence.kind === "goal") {
    if (source.id !== evidence.goalId) return unknown("source_mismatch");
    if (source.status === "removed") return unknown("ineligible_source");
    if (
      source.version !== evidence.goalVersion ||
      (source.progressAmountCents !== null &&
        source.progressAmountCents !== evidence.progressAmountCents)
    )
      return unknown("source_changed");
  }
  if (evidence.asOf > today) return unknown("future_as_of");
  if (source.currencyCode !== null && source.currencyCode !== evidence.currencyCode)
    return unknown("currency_mismatch");
  return { state: "applicable", evidence };
}
