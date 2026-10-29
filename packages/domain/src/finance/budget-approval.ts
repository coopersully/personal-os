import { z } from "zod";
import { type FinanceBudgetVersion, financeBudgetVersionSchema } from "./budget.js";
import type { FinanceToolResult } from "./common.js";

export const financeBudgetApprovalReadinessSchema = z.object({
  ready: z.boolean(),
  code: z.enum([
    "ready",
    "no_budget",
    "not_proposed",
    "invalid_budget",
    "profile_changed",
    "superseded",
  ]),
  recovery: z.enum(["approve", "create_proposal", "revise_proposal", "refresh_plan", "none"]),
  message: z.string(),
  budgetVersionId: z.string().nullable(),
  latestBudgetVersionId: z.string().nullable(),
  currentProfileVersionId: z.string().nullable(),
});
export type FinanceBudgetApprovalReadiness = z.infer<typeof financeBudgetApprovalReadinessSchema>;
export type FinanceBudgetReadResult = FinanceToolResult<FinanceBudgetVersion | null> & {
  approvalReadiness: FinanceBudgetApprovalReadiness;
};

/** Data prerequisites only. Approval still checks authenticated authority and locks current state. */
export function getFinanceBudgetApprovalReadiness(input: {
  budget: FinanceBudgetVersion | null;
  currentProfileVersionId: string | null;
  latestBudgetVersionId: string | null;
}): FinanceBudgetApprovalReadiness {
  const { budget, currentProfileVersionId, latestBudgetVersionId } = input;
  const base = {
    budgetVersionId: budget?.id ?? null,
    currentProfileVersionId,
    latestBudgetVersionId,
  };
  const blocked = (
    code: FinanceBudgetApprovalReadiness["code"],
    recovery: FinanceBudgetApprovalReadiness["recovery"],
    message: string,
  ): FinanceBudgetApprovalReadiness => ({ ...base, ready: false, code, recovery, message });
  if (!budget)
    return blocked("no_budget", "create_proposal", "Create a budget proposal before approving.");
  if (budget.id !== latestBudgetVersionId)
    return blocked(
      "superseded",
      "refresh_plan",
      "Review the latest budget revision before approving.",
    );
  if (budget.status !== "proposed")
    return blocked(
      "not_proposed",
      budget.status === "active" ? "none" : "revise_proposal",
      budget.status === "active"
        ? "This budget is already active."
        : "Create a complete proposal before approving.",
    );
  if (
    !financeBudgetVersionSchema.safeParse(budget).success ||
    [...budget.resources, ...budget.allocations].some(
      ({ amount }) => Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001,
    )
  )
    return blocked(
      "invalid_budget",
      "revise_proposal",
      "Review resources and allocations. The proposal must be complete and balance to the cent.",
    );
  if ((budget.profileVersionId ?? null) !== currentProfileVersionId)
    return blocked(
      "profile_changed",
      "revise_proposal",
      "Your financial profile changed. Review and save a new proposal using the current profile.",
    );
  return {
    ...base,
    ready: true,
    code: "ready",
    recovery: "approve",
    message:
      "Ready to approve this version. Permission and current revisions are checked again on approval.",
  };
}
