import { describe, expect, it } from "vitest";
import {
  financeDomainOutcomeSchema,
  financeMoneyFactReasonCodeSchema,
  financeMoneyFactSchema,
  financeRevisionRefSchema,
  financeWorkflowPortManifest,
  financeWorkflowPortResultSchema,
} from "./workflow-contracts.js";

describe("Finance workflow contracts", () => {
  it("advertises only the implemented resume port", () => {
    expect(financeWorkflowPortManifest).toHaveLength(7);
    expect(
      financeWorkflowPortManifest.filter((registration) => registration.state === "available"),
    ).toEqual([
      {
        port: "resumeFinance",
        state: "available",
        producer: "finances",
        route: { method: "POST", path: "/v1/finances/maintenance" },
      },
    ]);
    expect(
      financeWorkflowPortManifest
        .filter((registration) => registration.state === "unavailable")
        .every((registration) => registration.reasonCode === "producer_not_registered"),
    ).toBe(true);
  });

  it("rejects tenant authority smuggled across a producer boundary", () => {
    const reference = { id: "00000000-0000-4000-8000-000000000001", revision: "revision-1" };
    expect(financeRevisionRefSchema.safeParse(reference).success).toBe(true);
    expect(
      financeRevisionRefSchema.safeParse({
        ...reference,
        userId: "another-user",
      }).success,
    ).toBe(false);
  });

  it("accepts only canonical reason codes at the money evidence boundary", () => {
    const fact = { cents: null, currency: "USD", quality: "unavailable", sources: [] };
    for (const reason of financeMoneyFactReasonCodeSchema.options) {
      expect(financeMoneyFactSchema.safeParse({ ...fact, reasons: [reason] }).success).toBe(true);
    }
    for (const reason of ["future_unknown_code", "Provider error: private account 123", ""]) {
      expect(financeMoneyFactSchema.safeParse({ ...fact, reasons: [reason] }).success).toBe(false);
    }
    expect(
      financeMoneyFactSchema.safeParse({
        ...fact,
        reasons: ["stale_evidence"],
        providerText: "private",
      }).success,
    ).toBe(false);
  });

  it("represents stale and replayed operations with stable reason codes", () => {
    for (const reasonCode of ["stale_revision", "operation_replayed"] as const) {
      expect(
        financeDomainOutcomeSchema.parse({
          operationId: "00000000-0000-4000-8000-000000000001",
          state: "blocked",
          work: [],
          resultRevision: null,
          reasonCode,
        }),
      ).toMatchObject({
        operationId: "00000000-0000-4000-8000-000000000001",
        reasonCode,
      });
    }
  });

  it("gives producers a validating available-or-unavailable adapter", () => {
    const resultSchema = financeWorkflowPortResultSchema(financeRevisionRefSchema);
    expect(
      resultSchema.parse({
        state: "unavailable",
        reasonCode: "dependency_unavailable",
        retryable: true,
      }),
    ).toEqual({
      state: "unavailable",
      reasonCode: "dependency_unavailable",
      retryable: true,
    });
    expect(
      resultSchema.safeParse({
        state: "available",
        value: {
          id: "00000000-0000-4000-8000-000000000001",
          revision: "revision-1",
          userId: "other-user",
        },
      }).success,
    ).toBe(false);
  });
});
