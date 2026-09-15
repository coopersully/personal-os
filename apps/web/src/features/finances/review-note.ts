import type { FinanceInboxCase } from "@personal-os/domain";

export function savedClarification(review: FinanceInboxCase) {
  if (review.resolution?.type === "clarify" && typeof review.resolution.clarification === "string")
    return review.resolution.clarification;
  return typeof review.evidence?.clarification === "string"
    ? review.evidence.clarification
    : undefined;
}
