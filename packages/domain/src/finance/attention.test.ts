import { type FinanceAttentionRecord, projectFinanceAttention } from "./attention.js";

const record = (overrides: Partial<FinanceAttentionRecord> = {}): FinanceAttentionRecord => ({
  id: "flag:a",
  transactionId: "a",
  source: "transaction_flag",
  date: "2026-11-01",
  dependency: "none",
  decisionKey: null,
  workState: "processing",
  ...overrides,
});
const project = (records: FinanceAttentionRecord[], overrides = {}) =>
  projectFinanceAttention({
    firstMonth: "2026-11",
    period: "2026-11",
    complete: true,
    openingPositionQualified: true,
    budgetApproved: true,
    records,
    ...overrides,
  });

describe("Finance active attention", () => {
  it("separates historical work without treating flags as human decisions", () => {
    expect(
      project([
        record(),
        record({ id: "case:b", transactionId: "b", source: "review_case", date: "2026-10-31" }),
      ]),
    ).toMatchObject({
      activeDecisionCount: 0,
      activeTransactionCount: 1,
      historicalRecordCount: 1,
      processingCount: 1,
      budgetReady: false,
      rawCounts: { transactionFlags: 1, reviewCases: 1 },
    });
  });
  it("deduplicates only explicitly shared decisions, retaining all underlying records", () => {
    const output = project([
      record({ workState: "needs_person", decisionKey: "question:1" }),
      record({
        id: "case:a",
        source: "review_case",
        workState: "needs_person",
        decisionKey: "question:1",
      }),
      record({
        id: "case:a:2",
        source: "review_case",
        workState: "needs_person",
        decisionKey: null,
      }),
    ]);
    expect(output).toMatchObject({
      activeDecisionCount: 2,
      activeTransactionCount: 1,
      budgetReady: false,
      rawCounts: { transactionFlags: 1, reviewCases: 2 },
    });
  });
  it.each([
    "affects_current",
    "unknown",
  ] as const)("promotes historical %s dependencies", (dependency) => {
    expect(
      project([record({ date: "2026-10-31", dependency, workState: "technical_blocker" })]),
    ).toMatchObject({
      historicalRecordCount: 0,
      activeTransactionCount: 1,
      technicalBlockerCount: 1,
      budgetReady: false,
    });
  });
  it.each([null, "not-a-date", "2026-02-30"])("keeps uncertain date %s in triage", (date) => {
    expect(project([record({ date })])).toMatchObject({
      historicalRecordCount: 0,
      triageRecordCount: 1,
      budgetReady: false,
    });
  });
  it("does not hide unresolved November work on December rollover", () => {
    expect(project([record({ date: "2026-11-20" })], { period: "2026-12" })).toMatchObject({
      activeTransactionCount: 1,
      historicalRecordCount: 0,
      budgetReady: false,
    });
  });
  it("keeps unrelated future work distinct from this month's readiness", () => {
    expect(project([record({ date: "2026-12-01" })])).toMatchObject({
      activeTransactionCount: 0,
      futureRecordCount: 1,
      budgetReady: true,
    });
  });
  it.each([
    { complete: false },
    { openingPositionQualified: false },
    { budgetApproved: false },
  ])("does not call an empty inbox budget-ready with missing acceptance %j", (gate) => {
    expect(project([], gate).budgetReady).toBe(false);
  });
  it("allows a qualified approved budget with only independent historical work", () => {
    expect(project([record({ date: "2026-10-31" })]).budgetReady).toBe(true);
  });
  it("never silently scopes history without an approved starting policy", () => {
    expect(project([record({ date: "2026-10-31" })], { firstMonth: null })).toMatchObject({
      historicalRecordCount: 0,
      activeTransactionCount: 1,
      budgetReady: false,
    });
  });
  it("rejects duplicate record identities rather than undercounting work", () => {
    expect(() => project([record(), record()])).toThrow();
  });
  it.each(["2026-00", "2026-13", "garbage"])("rejects invalid policy month %s", (firstMonth) => {
    expect(() => project([], { firstMonth })).toThrow();
  });
});
