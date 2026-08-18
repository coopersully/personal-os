export type MerchantBehavior = "unknown" | "consistent" | "mixed";

export type MerchantEvidenceObservation = {
  category: string;
  outcome: "confirmed" | "corrected";
};

export type MerchantEvidenceInput = {
  behavior?: MerchantBehavior;
  merchantName: string;
  observations: MerchantEvidenceObservation[];
};

export type MerchantEvidence = {
  behavior: MerchantBehavior;
  category: string | null;
  confidence: number;
  merchantOnlyEligible: boolean;
  rationale: string;
};

const broadRetailer = /\b(?:amazon|cvs|costco|target|walmart)\b/iu;
const minimumConfirmations = 2;

/**
 * Merchant identity can narrow a suggestion, but it cannot turn a broad or
 * conflicting history into a durable categorization rule.
 */
export function evaluateMerchantEvidence(input: MerchantEvidenceInput): MerchantEvidence {
  const confirmations = input.observations.filter((item) => item.outcome === "confirmed");
  const corrections = input.observations.filter((item) => item.outcome === "corrected");
  const counts = new Map<string, number>();
  for (const item of confirmations) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  const ranked = [...counts.entries()].toSorted((left, right) => right[1] - left[1]);
  const [strongest] = ranked;
  const category = strongest?.[0] ?? null;
  const categoryDiversity = new Set(input.observations.map((item) => item.category)).size;
  const broadPrior = broadRetailer.test(input.merchantName);
  const behavior: MerchantBehavior =
    input.behavior === "mixed" || broadPrior || categoryDiversity > 1
      ? "mixed"
      : input.behavior === "consistent" ||
          (confirmations.length >= minimumConfirmations && category)
        ? "consistent"
        : "unknown";
  const confidence = category
    ? Math.round(
        Math.max(
          0,
          Math.min(0.99, 0.935 + (strongest?.[1] ?? 0) * 0.015 - corrections.length * 0.12),
        ) * 10_000,
      ) / 10_000
    : 0;
  const merchantOnlyEligible =
    behavior === "consistent" &&
    corrections.length === 0 &&
    (strongest?.[1] ?? 0) >= minimumConfirmations;
  const rationale =
    behavior === "mixed"
      ? broadPrior
        ? "This broad retailer has a conservative mixed-merchant prior; use transaction-specific evidence."
        : "Multiple categories appear in this merchant history; use transaction-specific evidence."
      : corrections.length > 0
        ? "Prior corrections lower merchant-only confidence; use transaction-specific evidence."
        : merchantOnlyEligible
          ? "Three uncorrected confirmations support this merchant-only category suggestion."
          : "More uncorrected confirmations are required before merchant identity can support a category.";
  return { behavior, category, confidence, merchantOnlyEligible, rationale };
}
