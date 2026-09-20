import { randomUUID } from "node:crypto";
import {
  createFinanceBudgetPolicySchema,
  financeBudgetPolicyLifecycleSchema,
  financeBudgetPolicyListSchema,
  saveFinanceBudgetPolicyPreviewSchema,
} from "./budget-policy-management.js";

describe("policy management commands", () => {
  it("requires explicit expected state and rejects authority/evidence injection", () => {
    const lifecycle = { idempotencyKey: "disable-1", expectedLifecycleRevision: 1 };
    expect(financeBudgetPolicyLifecycleSchema.parse(lifecycle)).toEqual(lifecycle);
    for (const injected of [
      { userId: randomUUID() },
      { approvalSource: "user_instruction" },
      { executionAvailable: true },
      { position: { state: "available" } },
      { usage: { consumedCents: 0 } },
    ])
      expect(
        financeBudgetPolicyLifecycleSchema.safeParse({ ...lifecycle, ...injected }).success,
      ).toBe(false);
    expect(financeBudgetPolicyLifecycleSchema.safeParse({ idempotencyKey: "x" }).success).toBe(
      false,
    );
    expect(createFinanceBudgetPolicySchema.safeParse({ planId: randomUUID() }).success).toBe(false);
  });
  it("bounds history reads and requires explicit preview expiry", () => {
    expect(financeBudgetPolicyListSchema.parse({ limit: 25 })).toEqual({ limit: 25 });
    for (const limit of [0, 101, 1.5])
      expect(financeBudgetPolicyListSchema.safeParse({ limit }).success).toBe(false);
    expect(
      saveFinanceBudgetPolicyPreviewSchema.safeParse({
        idempotencyKey: "save",
        expectedProposalRevision: 1,
      }).success,
    ).toBe(false);
  });
});
