import {
  financeActionFingerprint,
  financeCandidateActionFingerprint,
} from "./finance-action-identity.js";
import { semanticTargetKeys } from "./finance-action-service.js";

describe("Finance action identity", () => {
  it("uses one order-independent identity for reviews and candidates", () => {
    const left = { id: "00000000-0000-4000-8000-000000000001", nested: { b: 2, a: 1 } };
    const right = { nested: { a: 1, b: 2 }, id: "00000000-0000-4000-8000-000000000001" };
    const review = financeActionFingerprint("merchant", left);
    expect(review).toBe(financeActionFingerprint("merchant", right));
    expect(financeCandidateActionFingerprint("merchant", left)).toBe(`sha256:${review}`);
  });

  it("separates month plans from taxonomy-wide bucket plans", () => {
    expect(semanticTargetKeys("budget_plan", { month: "2026-08" })).toEqual([
      "budget-month:2026-08",
    ]);
    expect(semanticTargetKeys("budget_plan", { userId: "user-1" })).toEqual([
      "budget-buckets:user-1",
    ]);
  });
});
