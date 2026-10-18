import { approveFinanceBudgetInputSchema, financeSetupInputSchema } from "@personal-os/domain";
import { financeActionFingerprint } from "../finance-action-identity.js";
import { createFinanceService } from "../finance-service.js";
import type { Principal } from "../types.js";
import { isActiveBudgetAction, requireActiveBudgetAuthority } from "./budget-authority.js";

const principal: Principal = {
  actorId: "owner",
  actorType: "user",
  userId: "owner",
  scopes: new Set(["finances:write"]),
};
const input = { category: "Food", limit: 100, month: "2026-10" };

describe("active budget authority", () => {
  it("separates active allocation mutations from bucket organization", () => {
    expect(isActiveBudgetAction("budget_plan", input)).toBe(true);
    expect(isActiveBudgetAction("budget_plan", { allocations: [] })).toBe(true);
    expect(isActiveBudgetAction("budget_plan", { operation: "create" })).toBe(false);
    expect(isActiveBudgetAction("budget_plan", { operation: "update" })).toBe(false);
    expect(isActiveBudgetAction("profile", {})).toBe(false);
  });
  it("preserves exact human evidence while the requesting agent executes maintenance", () => {
    const financeBudgetApproval = {
      principal,
      reviewId: "review",
      fingerprint: financeActionFingerprint("budget_plan", input),
    };
    const context = {
      principal: { ...principal, actorId: "agent", actorType: "agent" as const },
      financeBudgetApproval,
    };
    expect(requireActiveBudgetAuthority(input, context)).toMatchObject({
      approvedByActorType: "user",
      approvedByActorId: "owner",
      reviewId: "review",
    });
    expect(() => requireActiveBudgetAuthority({ ...input, limit: 101 }, context)).toThrow(
      "does not match",
    );
    expect(() =>
      requireActiveBudgetAuthority(input, {
        ...context,
        principal: { ...context.principal, userId: "other" },
      }),
    ).toThrow("does not match");
  });
  it.each([
    "agent",
    "system",
  ] as const)("rejects %s execution and forged prepared flags at both semantic writers", async (actorType) => {
    const transaction = vi.fn();
    const service = createFinanceService({ db: { transaction } as never, now: () => new Date() });
    const context = {
      principal: { ...principal, actorType },
      financePreparedAction: true,
      financeReviewedExecution: true,
      requestId: "bypass",
    };
    await expect(service.createBudget(input, context as never)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(service.setBudgetPlan({} as never, context as never)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(transaction).not.toHaveBeenCalled();
  });
  it("rejects unreviewed human plan writes before opening a transaction", async () => {
    const transaction = vi.fn();
    const service = createFinanceService({ db: { transaction } as never, now: () => new Date() });
    await expect(
      service.setBudgetPlan({} as never, { principal, requestId: "delayed" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(transaction).not.toHaveBeenCalled();
  });
  it("requires human identity and write scope, including for carried approval", () => {
    expect(requireActiveBudgetAuthority(input, { principal })).toMatchObject({
      approvalSource: "user_instruction",
    });
    for (const invalid of [
      { ...principal, scopes: new Set<never>() },
      { ...principal, actorId: "other" },
      { ...principal, actorType: "agent" as const },
    ]) {
      expect(() => requireActiveBudgetAuthority(input, { principal: invalid })).toThrow(
        "human approval",
      );
      expect(() =>
        requireActiveBudgetAuthority(input, {
          principal,
          financeBudgetApproval: {
            principal: invalid,
            reviewId: "review",
            fingerprint: financeActionFingerprint("budget_plan", input),
          },
        }),
      ).toThrow("human approval");
    }
  });
  it("rejects self-approval in both new-write contracts", () => {
    const approval = {
      approvalSource: "agent_self_approval",
      budgetVersionId: crypto.randomUUID(),
      expectedVersion: 1,
      idempotencyKey: "approval",
    };
    expect(approveFinanceBudgetInputSchema.safeParse(approval).success).toBe(false);
    expect(
      financeSetupInputSchema.safeParse({
        ...approval,
        operation: "approve_budget",
        sessionId: crypto.randomUUID(),
      }).success,
    ).toBe(false);
  });
});
