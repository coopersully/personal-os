import {
  financeAccountQuerySchema,
  financeAccountSchema,
  financeBudgetAllocationSchema,
  financeBudgetBucketSchema,
  financeBudgetVersionSchema,
  financeCapabilityManifest,
  financeInboxCaseSchema,
  financeMaintenanceInputSchema,
  financePresentationSchema,
  financeProviderAccountTypeSchema,
  financeToolResultSchema,
  manageFinanceBudgetBucketInputSchema,
  manageFinanceRuleInputSchema,
} from "./finance.js";

const id = "11111111-1111-4111-8111-111111111111";
const relatedId = "22222222-2222-4222-8222-222222222222";
const now = "2026-08-23T16:00:00.000Z";

const basePresentation = {
  destination: null,
  diagnosticFacts: [],
  disclosures: [],
  eyebrow: "Finance",
  summary: "Grounded summary.",
  title: "Finance result",
};

const validPresentations = [
  {
    ...basePresentation,
    asOf: now,
    kind: "finance_snapshot",
    position: { cash: 100, debt: 20, investments: 50, netWorth: 130 },
    trust: { gaps: [], state: "current", trustworthy: true },
  },
  {
    ...basePresentation,
    allocations: [],
    assumptions: [],
    balance: 0,
    expectedResources: 100,
    kind: "finance_budget",
    status: "proposed",
    totalAllocated: 100,
  },
  {
    ...basePresentation,
    evidenceCount: 1,
    impactAmount: 12,
    kind: "finance_review",
    prompt: "What was this purchase?",
    reason: "The merchant is ambiguous.",
  },
  {
    ...basePresentation,
    cutoff: now,
    kind: "finance_period_verification",
    period: { end: "2026-08-28", start: "2026-08-01" },
    recommendations: [],
    status: "completed",
    work: { approvals: 0, exceptions: 0, questions: 0, rulesAndActions: 1 },
  },
] as const;

describe("canonical Finance contracts", () => {
  it("represents provider evidence and user-owned account planning semantics", () => {
    expect(financeProviderAccountTypeSchema.parse("investment")).toBe("investment");
    expect(() => financeProviderAccountTypeSchema.parse("wallet")).toThrow();

    expect(
      financeAccountSchema.parse({
        balance: 12_000,
        createdAt: now,
        currencyCode: "USD",
        id,
        includeInPlanning: true,
        institution: "Example Brokerage",
        kind: "investment",
        kindSource: "provider",
        lastSyncedAt: now,
        name: "IRA",
        ownershipShare: 0.5,
        ownershipType: "joint",
        provider: "plaid",
        providerSubtype: "ira",
        providerType: "investment",
        status: "connected",
        synchronization: {
          failureCode: null,
          failureCount: 0,
          lastAttemptAt: now,
          lastSuccessAt: now,
          message: null,
          nextRetryAt: null,
          recovery: null,
          state: "current",
        },
        updatedAt: now,
      }),
    ).toMatchObject({ kind: "investment", ownershipShare: 0.5 });
  });

  it("normalizes account discovery filters and rejects contradictory ownership", () => {
    expect(
      financeAccountQuerySchema.parse({
        includeExcluded: "false",
        kind: "investment",
        query: "  IRA  ",
      }),
    ).toEqual({ includeExcluded: false, kind: "investment", query: "IRA" });

    const base = {
      balance: 0,
      createdAt: now,
      currencyCode: "USD",
      id,
      includeInPlanning: true,
      institution: "Manual",
      kind: "cash" as const,
      kindSource: "user" as const,
      lastSyncedAt: null,
      name: "Cash",
      provider: "manual" as const,
      providerSubtype: null,
      providerType: null,
      status: "manual" as const,
      synchronization: {
        failureCode: null,
        failureCount: 0,
        lastAttemptAt: null,
        lastSuccessAt: null,
        message: null,
        nextRetryAt: null,
        recovery: null,
        state: "current" as const,
      },
      updatedAt: now,
    };
    expect(() =>
      financeAccountSchema.parse({
        ...base,
        ownershipShare: 0.5,
        ownershipType: "individual",
      }),
    ).toThrow("Individual accounts must use a 100% ownership share");
    expect(() =>
      financeAccountSchema.parse({
        ...base,
        ownershipShare: null,
        ownershipType: "joint",
      }),
    ).toThrow("Joint accounts require an ownership share");
    expect(() =>
      financeAccountSchema.parse({
        ...base,
        ownershipShare: 1,
        ownershipType: "unknown",
      }),
    ).toThrow("Unknown ownership cannot claim a known ownership share");
  });

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
    const base = {
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
    };
    expect(() => financeBudgetVersionSchema.parse(base)).toThrow(
      "Budget resources and allocations must balance",
    );
    expect(() =>
      financeBudgetVersionSchema.parse({
        ...base,
        allocatedTotal: 0,
        balanceDelta: 5000,
      }),
    ).toThrow("Budget resources and allocations must balance");
    expect(() =>
      financeBudgetVersionSchema.parse({
        ...base,
        allocatedTotal: 0,
        balanceDelta: 0,
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

  it("parses the four bounded Finance presentation kinds", () => {
    expect(validPresentations.map((value) => financePresentationSchema.parse(value).kind)).toEqual([
      "finance_snapshot",
      "finance_budget",
      "finance_review",
      "finance_period_verification",
    ]);
  });

  it("rejects more than fifty diagnostic facts", () => {
    expect(() =>
      financePresentationSchema.parse({
        ...validPresentations[0],
        diagnosticFacts: Array.from({ length: 51 }, (_, index) => ({
          label: `Fact ${index}`,
          value: index,
        })),
      }),
    ).toThrow();
  });

  it("accepts an optional presentation on a Finance tool result", () => {
    expect(
      financeToolResultSchema.parse({
        changes: [],
        communication: {
          headline: "Snapshot ready.",
          optionalDetails: [],
          requiredDisclosures: [],
        },
        data: {},
        outcome: "completed",
        presentation: validPresentations[0],
        remainingWork: { categories: [], count: 0 },
        schemaVersion: 1,
      }).presentation,
    ).toMatchObject({ kind: "finance_snapshot" });
  });

  it("requires rule updates to change the category or merchant", () => {
    const mutation = { idempotencyKey: "rule-update", operation: "update", ruleId: id } as const;
    expect(
      manageFinanceRuleInputSchema.parse({ ...mutation, category: "Groceries" }),
    ).toMatchObject({
      category: "Groceries",
    });
    expect(
      manageFinanceRuleInputSchema.parse({ ...mutation, merchant: "Corner market" }),
    ).toMatchObject({
      merchant: "Corner market",
    });
    expect(() => manageFinanceRuleInputSchema.parse(mutation)).toThrow(
      "Provide a category or merchant to update",
    );
  });

  it("keeps bucket descriptions and exclusive-membership inputs explicit", () => {
    expect(
      financeBudgetBucketSchema.parse({
        categories: [id, relatedId],
        createdAt: now,
        description: "Needs and recurring commitments",
        id,
        name: "Essentials",
        position: 0,
        updatedAt: now,
        version: 1,
      }).description,
    ).toBe("Needs and recurring commitments");
    expect(
      manageFinanceBudgetBucketInputSchema.parse({
        categoryIds: [id, relatedId],
        description: null,
        expectedVersion: 1,
        idempotencyKey: "bucket-update",
        name: "Essentials",
        operation: "update",
        bucketId: id,
      }),
    ).toMatchObject({ categoryIds: [id, relatedId], operation: "update" });
  });
});
