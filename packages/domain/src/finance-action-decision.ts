export type FinanceActionDecision = "deny" | "ask" | "propose" | "execute";

export type FinanceActionDecisionInput = {
  permitted: boolean;
  /** True for a financial mutation, including an ordinary financial edit. */
  mutation: boolean;
  bypass: boolean;
  information: "sufficient" | "missing" | "conflicting";
};

/**
 * Proposed financial approval contract, separate from legacy execution policy.
 * The API owns permission, evidence and mutation classification, and must recheck
 * current authority before an effect. Knowledge capture never grants authority.
 */
export function decideFinanceAction(input: FinanceActionDecisionInput): FinanceActionDecision {
  if (!input.permitted) return "deny";
  if (input.information !== "sufficient") return "ask";
  if (input.mutation && !input.bypass) return "propose";
  return "execute";
}
