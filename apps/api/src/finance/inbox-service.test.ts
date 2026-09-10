import type { FinanceReviewReason } from "@personal-os/domain";
import { financeReviewPrompt } from "./inbox-service.js";

describe("Finance Inbox questions", () => {
  it.each<FinanceReviewReason>([
    "budget_variance",
    "category_ambiguity",
    "merchant_identity",
    "missing_provenance",
    "possible_duplicate",
    "possible_transfer",
    "profile_fact",
    "recurring_status",
    "refund_or_reversal",
    "reimbursement",
    "source_freshness",
    "unusual_amount",
  ])("renders one concise question for %s", (reason) => {
    expect(financeReviewPrompt(reason, {})).toMatch(/\?$/);
  });

  it("uses known merchant evidence without changing review identity", () => {
    expect(financeReviewPrompt("unusual_amount", { merchant: "Corner Store" })).toContain(
      "at Corner Store",
    );
    expect(financeReviewPrompt("unusual_amount", { merchant: 42 })).not.toContain("at 42");
  });
});
