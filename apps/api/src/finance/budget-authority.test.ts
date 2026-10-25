import { describe, expect, it } from "vitest";
import { financeActionFingerprint } from "../finance-action-identity.js";
import type { Principal } from "../types.js";
import {
  isActiveBudgetAction,
  requireActiveBudgetAuthority,
  requireBudgetApproval,
} from "./budget-authority.js";

const agent: Principal = {
  actorType: "agent",
  actorId: "execution-token",
  userId: "owner",
  scopes: new Set(["finances:write", "finances:execute"]),
};

describe("Finance standing approval", () => {
  it("allows execution agents to approve budgets only with enabled bypass", () => {
    expect(() => requireBudgetApproval(agent, true)).not.toThrow();
    expect(() => requireBudgetApproval(agent, false)).toThrow("review bypass");
    for (const scopes of [[], ["finances:write"], ["finances:execute"]] as const)
      expect(() => requireBudgetApproval({ ...agent, scopes: new Set(scopes) }, true)).toThrow();
  });

  it("retains owner approval without bypass and rejects other actors or owner impersonation", () => {
    const human: Principal = {
      ...agent,
      actorType: "user",
      actorId: "owner",
      scopes: new Set(["finances:write"]),
    };
    expect(() => requireBudgetApproval(human)).not.toThrow();
    expect(() => requireBudgetApproval({ ...human, actorId: "other" }, true)).toThrow();
  });
});

describe("exact active budget authority", () => {
  const input = { category: "Food", limit: 100, month: "2026-10" };
  const owner: Principal = { ...agent, actorType: "user", actorId: "owner" };
  const policy = (reviewBypassEnabled: boolean) => ({
    select: () => ({
      from: () => ({
        where: () => ({ for: () => ({ limit: async () => [{ reviewBypassEnabled }] }) }),
      }),
    }),
  });
  it("separates active allocation changes from bucket organization", () => {
    expect(isActiveBudgetAction("budget_plan", input)).toBe(true);
    expect(isActiveBudgetAction("budget_plan", { allocations: [] })).toBe(true);
    expect(isActiveBudgetAction("budget_plan", { operation: "create" })).toBe(false);
    expect(isActiveBudgetAction("budget_plan", { operation: "update" })).toBe(false);
    expect(isActiveBudgetAction("profile", {})).toBe(false);
  });
  it("retains exact owner approval when an agent executes a reviewed change", async () => {
    const context = {
      principal: agent,
      financeBudgetApproval: {
        principal: owner,
        reviewId: "review",
        fingerprint: financeActionFingerprint("budget_plan", input),
      },
    };
    await expect(
      requireActiveBudgetAuthority(input, context, policy(false) as never),
    ).resolves.toMatchObject({
      approvedByActorType: "user",
      approvedByActorId: "owner",
      reviewId: "review",
    });
    await expect(
      requireActiveBudgetAuthority({ ...input, limit: 101 }, context, policy(false) as never),
    ).rejects.toThrow("does not match");
    await expect(
      requireActiveBudgetAuthority(
        input,
        { ...context, principal: { ...agent, userId: "other" } },
        policy(false) as never,
      ),
    ).rejects.toThrow("does not match");
  });
  it("requires a transaction and either an exact receipt or a prepared action under bypass", async () => {
    await expect(requireActiveBudgetAuthority(input, { principal: owner })).rejects.toThrow(
      "transaction",
    );
    await expect(
      requireActiveBudgetAuthority(
        input,
        { principal: owner, financePreparedAction: true },
        policy(false) as never,
      ),
    ).rejects.toThrow("Submit the exact");
    await expect(
      requireActiveBudgetAuthority(input, { principal: owner }, policy(true) as never),
    ).rejects.toThrow("Submit the exact");
    await expect(
      requireActiveBudgetAuthority(
        input,
        { principal: owner, financePreparedAction: true },
        policy(true) as never,
      ),
    ).resolves.toMatchObject({ approvalSource: "user_instruction" });
  });
});
