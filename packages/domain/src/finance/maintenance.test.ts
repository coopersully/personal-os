import { describe, expect, it } from "vitest";
import { financeMaintenanceInputSchema } from "./maintenance.js";

describe("canonical Finance maintenance intent", () => {
  it("accepts exact canonical scopes and explicit resume", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(
      financeMaintenanceInputSchema.parse({
        operation: "start",
        scope: { type: "target", entityType: "finance_account", id },
      }),
    ).toEqual({ operation: "start", scope: { type: "target", entityType: "finance_account", id } });
    expect(financeMaintenanceInputSchema.parse({ operation: "resume", runId: id })).toEqual({
      operation: "resume",
      runId: id,
    });
    expect(
      financeMaintenanceInputSchema.safeParse({
        operation: "start",
        scope: { type: "window", start: "2026-09-01", end: "2026-08-31" },
      }).success,
    ).toBe(false);
  });

  it("rejects weak judgment and audit submissions instead of accepting an alias", () => {
    const runId = "00000000-0000-4000-8000-000000000001";
    expect(
      financeMaintenanceInputSchema.safeParse({
        operation: "submit_audit",
        runId,
        expectedVersion: 1,
        idempotencyKey: "audit",
        findings: [],
      }).success,
    ).toBe(false);
    expect(
      financeMaintenanceInputSchema.safeParse({
        operation: "submit_judgments",
        runId,
        expectedVersion: 1,
        idempotencyKey: "judge",
        judgments: [
          {
            type: "needs_user_review",
            transactionId: runId,
            confidence: 1,
            questionReason: "Uncertain",
          },
        ],
      }).success,
    ).toBe(false);
  });
});
