import type { MaterialSourceReference } from "@personal-os/domain";

type Observation = {
  amountCents: number;
  category: string | null;
  date: string;
  id: string;
  merchant: string;
  sourceRef: MaterialSourceReference;
};
type Input = {
  budgetMaterialityCents: number;
  expectedRecurring?: {
    expectedAmountCents: number;
    expectedDate: string | null;
    toleranceCents: number;
    windowDays: number;
  };
  history: Observation[];
  reimbursementExpectedCents?: number;
  transaction: Observation;
};
export type FinanceAnomaly = {
  baselineCents: number;
  baselineSource: "category" | "merchant";
  rationale: string;
  severity: "warning";
  sourceRefs: MaterialSourceReference[];
};

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

/** Uses robust median absolute deviation rather than a universal dollar cutoff. */
export function detectFinanceAnomalies(input: Input): FinanceAnomaly | null {
  const expectedRecurring = input.expectedRecurring;
  const withinRecurringAmount =
    expectedRecurring !== undefined &&
    Math.abs(input.transaction.amountCents - expectedRecurring.expectedAmountCents) <=
      expectedRecurring.toleranceCents;
  const withinRecurringWindow =
    expectedRecurring?.expectedDate !== null &&
    expectedRecurring !== undefined &&
    Math.abs(
      new Date(`${input.transaction.date}T00:00:00Z`).getTime() -
        new Date(`${expectedRecurring.expectedDate}T00:00:00Z`).getTime(),
    ) <=
      expectedRecurring.windowDays * 86_400_000;
  if (expectedRecurring && withinRecurringAmount && withinRecurringWindow) return null;
  if (expectedRecurring?.expectedDate && withinRecurringAmount && !withinRecurringWindow) {
    return {
      baselineCents: expectedRecurring.expectedAmountCents,
      baselineSource: "merchant",
      rationale: "A recurring charge arrived outside its expected cadence window.",
      severity: "warning",
      sourceRefs: [input.transaction.sourceRef],
    };
  }
  const merchant = input.history.filter((item) => item.merchant === input.transaction.merchant);
  const category = input.history.filter((item) => item.category === input.transaction.category);
  const sample = merchant.length >= 5 ? merchant : category;
  if (sample.length < 5) return null;
  const baseline = median(sample.map((item) => item.amountCents));
  const mad = median(sample.map((item) => Math.abs(item.amountCents - baseline)));
  const materialDifference = input.transaction.amountCents - baseline;
  // MAD can be zero for stable rent; retain a relative robust floor rather than a global amount.
  const robustBand = Math.max(mad * 3, Math.max(100, baseline * 0.2));
  if (materialDifference <= Math.max(robustBand, input.budgetMaterialityCents)) return null;
  const reimbursement = input.reimbursementExpectedCents
    ? ` It includes $${(input.reimbursementExpectedCents / 100).toFixed(2)} expected reimbursement.`
    : "";
  return {
    baselineCents: baseline,
    baselineSource: merchant.length >= 5 ? "merchant" : "category",
    rationale: `Amount is materially above its robust ${merchant.length >= 5 ? "merchant" : "category"} baseline of $${(baseline / 100).toFixed(2)}.${reimbursement}`,
    severity: "warning",
    sourceRefs: [input.transaction.sourceRef, ...sample.map((item) => item.sourceRef)],
  };
}
