import { describe, expect, it } from "vitest";
import { type ExecutionPolicyAction, evaluateExecutionPolicy } from "./execution-policy.js";

const settings = { reviewBypassEnabled: true, version: 1 };
const financeAction: ExecutionPolicyAction = {
  domain: "finances",
  operation: "transaction",
  authority: "policy_authorized",
  effect: "reversible",
  capabilityAvailable: true,
  requiredScopeGranted: true,
};

describe("global execution policy", () => {
  it("enables bypass only for a registered reversible Finance action", () => {
    expect(evaluateExecutionPolicy(settings, financeAction)).toEqual({
      state: "execute",
      reasonCode: "registered_bypass",
    });
    expect(
      evaluateExecutionPolicy({ ...settings, reviewBypassEnabled: false }, financeAction),
    ).toEqual({ state: "queue_review", reasonCode: "review_required" });
  });

  it.each([
    "mail",
    "calendar",
    "reminders",
    "tasks",
    "goals",
  ] as const)("does not widen %s authority when global bypass is enabled", (domain) => {
    expect(evaluateExecutionPolicy(settings, { ...financeAction, domain })).toEqual({
      state: "queue_review",
      reasonCode: "review_required",
    });
  });

  it("does not widen an unregistered Finance operation", () => {
    expect(
      evaluateExecutionPolicy(settings, { ...financeAction, operation: "future_operation" }),
    ).toEqual({ state: "queue_review", reasonCode: "review_required" });
  });

  it("preserves scopes and stronger approval requirements", () => {
    expect(
      evaluateExecutionPolicy(settings, { ...financeAction, requiredScopeGranted: false }),
    ).toEqual({ state: "blocked", reasonCode: "scope_denied" });
    expect(
      evaluateExecutionPolicy(settings, {
        ...financeAction,
        authority: "approval_required",
        effect: "irreversible",
      }),
    ).toEqual({ state: "require_approval", reasonCode: "explicit_approval_required" });
  });

  it("returns explicit safe states for missing or unavailable capabilities", () => {
    expect(
      evaluateExecutionPolicy(settings, { ...financeAction, capabilityAvailable: false }),
    ).toEqual({ state: "unavailable", reasonCode: "capability_unavailable" });
    expect(
      evaluateExecutionPolicy(settings, { ...financeAction, authority: "missing_information" }),
    ).toEqual({ state: "needs_input", reasonCode: "missing_information" });
  });
});
