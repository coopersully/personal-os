import { describe, expect, it } from "vitest";
import {
  isExpectedAnswerValue,
  normalizedMerchantRuleKey,
  profileProjection,
  semanticTargetKeys,
  supportedActionKind,
} from "./finance-action-service.js";

describe("Finance action deterministic helpers", () => {
  it("normalizes a merchant rule key without keeping checkout suffixes", () => {
    expect(normalizedMerchantRuleKey("ACME*1234 #18")).toBe("acme");
    expect(normalizedMerchantRuleKey("Café & Market 20261234")).toBe("caf market");
  });

  it("rejects stored actions that cannot be resumed", () => {
    expect(supportedActionKind("transaction")).toBe("transaction");
    expect(() => supportedActionKind("maintenance_turn")).toThrow("cannot be resumed");
  });

  it("keeps semantic target locks aligned across every action family", () => {
    expect(semanticTargetKeys("profile", { effectiveDate: "2026-08-01" })).toEqual([
      "profile:2026-08-01",
    ]);
    expect(semanticTargetKeys("budget_plan", { month: "2026-08" })).toEqual([
      "budget-month:2026-08",
    ]);
    expect(
      semanticTargetKeys("categorization", {
        decisions: [{ transactionId: "b" }, { transactionId: "a" }],
      }),
    ).toEqual(["a", "b"]);
    expect(semanticTargetKeys("merchant", { id: "merchant" })).toEqual(["merchant:merchant"]);
    expect(
      semanticTargetKeys("merchant", { sourceMerchantId: "b", targetMerchantId: "a" }),
    ).toEqual(["merchant:a", "merchant:b"]);
    expect(semanticTargetKeys("recurring_obligation", { id: "recurring" })).toEqual([
      "recurring:recurring",
    ]);
    expect(semanticTargetKeys("alert", { operation: "refresh" })).toEqual(["alert:refresh"]);
    expect(semanticTargetKeys("alert", { id: "alert", operation: "resolve" })).toEqual([
      "alert:alert",
    ]);
    expect(
      semanticTargetKeys("transaction", {
        accountId: "account",
        date: "2026-08-01",
        merchant: "Cafe",
      }),
    ).toEqual(["transaction-create:account:2026-08-01:Cafe"]);
    expect(semanticTargetKeys("transaction", { id: "transaction" })).toEqual([
      "transaction:transaction",
    ]);
    expect(semanticTargetKeys("transaction_breakdown", { id: "transaction" })).toEqual([
      "transaction:transaction",
    ]);
    expect(semanticTargetKeys("income_stream", { id: "income" })).toEqual(["income:income"]);
    expect(
      semanticTargetKeys("reimbursement", { allocationId: "allocation", operation: "create" }),
    ).toEqual(["allocation:allocation"]);
    expect(
      semanticTargetKeys("reimbursement", {
        creditTransactionId: "credit",
        operation: "match_credit",
        reimbursementId: "reimbursement",
      }),
    ).toEqual(["reimbursement:reimbursement", "credit:credit"]);
    expect(
      semanticTargetKeys("reimbursement", {
        operation: "cancel",
        reimbursementId: "reimbursement",
      }),
    ).toEqual(["reimbursement:reimbursement"]);
  });

  it("reports only material profile changes without exposing private values", () => {
    expect(profileProjection(undefined, { effectiveDate: "2026-08-01" })).toBe(
      "Update profile effective 2026-08-01.",
    );
    const summary = profileProjection(
      {
        dependents: 0,
        effectiveDate: "2026-08-01",
        employer: "Old employer",
        expectedNetPay: 100_00,
        grossAnnualIncome: 100_000_00,
        householdSize: 1,
        role: "Old role",
      } as never,
      {
        dependents: 1,
        effectiveDate: "2026-09-01",
        employer: "New employer",
        expectedNetPay: 200,
        grossAnnualIncome: 200000,
        householdSize: 2,
        role: "New role",
      },
    );
    expect(summary).toContain("employer updated");
    expect(summary).toContain("role updated");
    expect(summary).not.toContain("New employer");
    expect(summary).toContain("net pay $100.00 → $200.00");
  });

  it("validates scalar and structured question answer values", () => {
    const field = (type: string, nullable = false, choices?: string[]) =>
      ({ choices, nullable, required: true, type }) as never;
    expect(isExpectedAnswerValue(field("boolean"), true)).toBe(true);
    expect(isExpectedAnswerValue(field("number"), Number.NaN)).toBe(false);
    expect(isExpectedAnswerValue(field("string"), "answer")).toBe(true);
    expect(isExpectedAnswerValue(field("object"), {})).toBe(true);
    expect(isExpectedAnswerValue(field("object"), [])).toBe(false);
    expect(isExpectedAnswerValue(field("object_array"), [{ value: 1 }])).toBe(true);
    expect(isExpectedAnswerValue(field("object_array"), ["wrong"])).toBe(false);
    expect(
      isExpectedAnswerValue(field("string_array", false, ["one", "two"]), ["one", "two"]),
    ).toBe(true);
    expect(isExpectedAnswerValue(field("string_array", false, ["one"]), ["two"])).toBe(false);
    expect(isExpectedAnswerValue(field("string", true), null)).toBe(true);
    expect(isExpectedAnswerValue(field("string"), null)).toBe(false);
  });
});
