import { type Database, executionPolicySettings } from "@personal-os/database";
import { eq } from "drizzle-orm";
import { AppError } from "../errors.js";
import { financeActionFingerprint } from "../finance-action-identity.js";
import type { Principal } from "../types.js";
import { requireWorkspaceExecution } from "../workspace-execution.js";

/** Server-only approval evidence for the exact semantic write; actor provenance is retained. */
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

export function requireBudgetApproval(
  principal: Pick<Principal, "actorType" | "actorId" | "userId" | "scopes">,
  bypassEnabled = false,
) {
  const human = principal.actorType === "user" && principal.actorId === principal.userId;
  const agent =
    principal.actorType === "agent" && bypassEnabled && principal.scopes.has("finances:execute");
  if (!principal.scopes.has("finances:write") || (!human && !agent))
    throw new AppError(
      "forbidden",
      "Budget approval requires the owner or an execution agent with review bypass enabled.",
    );
}

export async function requireActiveBudgetAuthority(
  input: Record<string, unknown>,
  context: {
    principal: Principal;
    financeBudgetApproval?: FinanceBudgetApproval;
    financePreparedAction?: boolean;
  },
  executor?: Pick<Database, "select">,
) {
  const approval = context.financeBudgetApproval;
  const principal = approval?.principal ?? context.principal;
  if (!executor)
    throw new AppError("forbidden", "Budget changes require an exact prepared action transaction.");
  const [policy] = await executor
    .select()
    .from(executionPolicySettings)
    .where(eq(executionPolicySettings.userId, principal.userId))
    .for("share")
    .limit(1);
  const bypass = policy?.reviewBypassEnabled === true;
  if (principal.actorType === "agent")
    await requireWorkspaceExecution(executor, principal, "finances");
  requireBudgetApproval(principal, bypass);
  if (!approval && !(context.financePreparedAction && bypass))
    throw new AppError(
      "forbidden",
      "Submit the exact budget change for approval or enable review bypass.",
    );
  if (
    approval &&
    (principal.userId !== context.principal.userId ||
      approval.fingerprint !== financeActionFingerprint("budget_plan", input))
  ) {
    throw new AppError("forbidden", "The recorded approval does not match this budget change.");
  }
  return {
    approvalSource: principal.actorType === "agent" ? "agent_self_approval" : "user_instruction",
    approvalFingerprint: financeActionFingerprint("budget_plan", input),
    approvedByActorId: principal.actorId,
    approvedByActorType: principal.actorType,
    ...(approval ? { reviewId: approval.reviewId } : {}),
  };
}
