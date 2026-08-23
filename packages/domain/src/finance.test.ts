import {
  financeBudgetAllocationSchema,
  financeBudgetVersionSchema,
  financeCapabilityManifest,
  financeInboxCaseSchema,
  financeMaintenanceInputSchema,
  financeToolResultSchema,
} from "./finance.js";

const id = "11111111-1111-4111-8111-111111111111";
const relatedId = "22222222-2222-4222-8222-222222222222";
const now = "2026-08-23T16:00:00.000Z";

describe("canonical Finance contracts", () => {
  it("maps every Finance capability to an unambiguous API operation and MCP tool", () => {
    expect(financeCapabilityManifest).toContainEqual({
      capability: "workflow.setup",
      apiOperation: "setupFinances",
      mcpTool: "setup_finances",
      mode: "write",
      requiredScope: "finances:write",
    });
    expect(new Set(financeCapabilityManifest.map((item) => item.capability)).size).toBe(
      financeCapabilityManifest.length,
    );
    expect(new Set(financeCapabilityManifest.map((item) => item.mcpTool)).size).toBe(
      financeCapabilityManifest.length,
    );
  });

  it("requires a complete budget version to balance to the cent", () => {
    expect(() =>
      financeBudgetVersionSchema.parse({
        allocations: [],
        allocatedTotal: 4_900,
        approvedAt: null,
        assumptions: [],
        balanceDelta: 100,
        createdAt: now,
        effectiveFrom: "2026-08",
        expectedResources: 5_000,
        id,
        planId: relatedId,
        rationale: "Initial plan",
        resources: [{ amount: 5_000, key: "income", kind: "income" }],
        status: "proposed",
        version: 1,
      }),
    ).toThrow("Budget resources and allocations must balance");
  });

  it("can expose an incomplete migrated allocation without inventing a category id", () => {
    expect(
      financeBudgetAllocationSchema.parse({
        amount: 100,
        key: "legacy-rent",
        kind: "spending",
        legacyCategory: "Rent",
      }),
    ).toMatchObject({ legacyCategory: "Rent" });
  });

  it("uses stable economic-event and reason identity for Inbox cases", () => {
    const parsed = financeInboxCaseSchema.parse({
      economicEventId: relatedId,
      evidence: {},
      firstSeenAt: now,
      id,
      impactAmount: 12,
      lastSeenAt: now,
      proposedResolution: null,
      reason: "merchant_identity",
      reopenedFromId: null,
      resolvedAt: null,
      stableKey: "event:merchant_identity",
      status: "open",
    });

    expect(parsed.stableKey).toBe("event:merchant_identity");
  });

  it("parses caller-driven maintenance starts without queue state", () => {
    expect(
      financeMaintenanceInputSchema.parse({
        operation: "start",
        scope: { type: "all_outstanding" },
      }),
    ).toEqual({
      operation: "start",
      scope: { type: "all_outstanding" },
    });
  });

  it("separates the one next question from optional detail", () => {
    const parsed = financeToolResultSchema.parse({
      changes: [],
      communication: {
        headline: "One item needs your answer.",
        nextQuestion: {
          answerType: "integer",
          id: "profile:household_size",
          prompt: "How many people are in your financial household?",
        },
        optionalDetails: [],
        requiredDisclosures: [],
      },
      data: {},
      outcome: "user_input_required",
      remainingWork: { categories: ["profile"], count: 1 },
      schemaVersion: 1,
    });

    expect(parsed.communication.nextQuestion?.id).toBe("profile:household_size");
  });
});
