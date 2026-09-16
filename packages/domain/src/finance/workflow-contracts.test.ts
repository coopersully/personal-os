import { describe, expect, it } from "vitest";
import {
  financeDomainOutcomeSchema,
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
    expect(
      financeRevisionRefSchema.safeParse({
        id: "source-1",
        revision: "revision-1",
        userId: "another-user",
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
        value: { id: "source-1", revision: "revision-1", userId: "other-user" },
      }).success,
    ).toBe(false);
  });
});
