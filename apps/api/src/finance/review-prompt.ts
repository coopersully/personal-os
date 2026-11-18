import type { FinanceReviewReason } from "@personal-os/domain";

export function financeReviewPrompt(
  reason: FinanceReviewReason,
  evidence: Record<string, unknown>,
): string {
  if (typeof evidence.prompt === "string" && evidence.prompt.trim()) {
    return evidence.prompt.trim().slice(0, 1_000);
  }
  const merchant = typeof evidence.merchant === "string" ? ` at ${evidence.merchant}` : "";
  const prompts: Record<FinanceReviewReason, string> = {
    budget_variance: "Was this budget variance expected, and should the budget change?",
    category_ambiguity: `What did this transaction${merchant} represent?`,
    merchant_identity: `What was this transaction${merchant} for?`,
    missing_provenance: "What is the source and purpose of this transaction?",
    possible_duplicate: "Are these charges duplicates, or are both legitimate?",
    possible_transfer: "Was this movement a transfer between your own accounts?",
    profile_fact: "What should this financial profile fact be?",
    recurring_status: "Is this still a recurring obligation?",
    refund_or_reversal: "Was this transaction a refund or reversal of another charge?",
    reimbursement: "Which expense did this reimbursement offset?",
    source_freshness: "Does this account need to be reconnected or updated manually?",
    unusual_amount: `Was this unusually large transaction${merchant} expected and legitimate?`,
  };
  return prompts[reason];
}

/** Only these literal prompts disclose no transaction or owner data in minimal SMS. */
export function minimalSmsQuestionPrompt(prompt: string): string | null {
  const publicPrompts = new Set([
    "What was this transaction for?",
    "Was this budget variance expected, and should the budget change?",
    "What did this transaction represent?",
    "What is the source and purpose of this transaction?",
    "Are these charges duplicates, or are both legitimate?",
    "Was this movement a transfer between your own accounts?",
    "What should this financial profile fact be?",
    "Is this still a recurring obligation?",
    "Was this transaction a refund or reversal of another charge?",
    "Which expense did this reimbursement offset?",
    "Does this account need to be reconnected or updated manually?",
    "Was this unusually large transaction expected and legitimate?",
  ]);
  return publicPrompts.has(prompt) ? prompt : null;
}
