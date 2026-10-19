import { AppError } from "../errors.js";
import { financeActionFingerprint } from "../finance-action-identity.js";
import type { Principal } from "../types.js";

/** Server-only evidence carried from an authenticated review to its exact semantic write. */
export type FinanceBudgetApproval = {
  fingerprint: string;
  principal: Principal;
  reviewId: string;
};

export function isActiveBudgetAction(actionKind: string, input: Record<string, unknown>) {
  return (
    actionKind === "budget_plan" && input.operation !== "create" && input.operation !== "update"
  );
}

export function requireHumanBudgetApproval(
  principal: Pick<Principal, "actorType" | "actorId" | "userId" | "scopes">,
) {
  if (
    principal.actorType !== "user" ||
    principal.actorId !== principal.userId ||
    !principal.scopes.has("finances:write")
  ) {
    throw new AppError(
      "forbidden",
      "Every active budget change requires exact authenticated human approval.",
    );
  }
}

export function requireActiveBudgetAuthority(
  input: Record<string, unknown>,
  context: { principal: Principal; financeBudgetApproval?: FinanceBudgetApproval },
) {
  const approval = context.financeBudgetApproval;
  const principal = approval?.principal ?? context.principal;
  requireHumanBudgetApproval(principal);
  if (
    approval &&
    (principal.userId !== context.principal.userId ||
      approval.fingerprint !== financeActionFingerprint("budget_plan", input))
  ) {
    throw new AppError("forbidden", "The human approval does not match this budget change.");
  }
  return {
    approvalSource: "user_instruction",
    approvalFingerprint: financeActionFingerprint("budget_plan", input),
    approvedByActorId: principal.actorId,
    approvedByActorType: principal.actorType,
    ...(approval ? { reviewId: approval.reviewId } : {}),
  };
}
