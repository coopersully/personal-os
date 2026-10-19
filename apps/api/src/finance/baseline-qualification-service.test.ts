import { getTableName } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { createFinanceBudgetBaselineQualificationService } from "./baseline-qualification-service.js";

const evidence = vi.hoisted(() => ({ prepare: vi.fn() }));
// Exercise service decisions without claiming PostgreSQL idempotency or lock proof.
vi.mock("./context.js", async (original) => ({
  ...(await original<typeof import("./context.js")>()),
  executeFinanceIdempotently: async (
    db: { transaction: (work: unknown) => unknown },
    _context: unknown,
    _options: unknown,
    work: unknown,
  ) => db.transaction(work),
}));
vi.mock("./baseline-qualification-evidence.js", async (original) => ({
  ...(await original<typeof import("./baseline-qualification-evidence.js")>()),
  prepareBaselineEvidence: evidence.prepare,
}));
const ownerId = "11111111-1111-4111-8111-111111111111";
const versionId = "22222222-2222-4222-8222-222222222222";
const planId = "33333333-3333-4333-8333-333333333333";
const accountId = "44444444-4444-4444-8444-444444444444";
const qualificationId = "55555555-5555-4555-8555-555555555555";
const stamp = new Date("2026-10-18T12:00:00Z");
function fixture() {
  const version = {
    id: versionId,
    planId,
    version: 3,
    approvedAt: stamp,
    approvedByActorType: "connector",
    status: "retired",
    balanceDelta: 0,
    expectedResources: 100,
    allocatedTotal: 100,
  };
  const snapshot = {
    accountIds: [accountId],
    allocations: [
      { key: "food", categoryId: null, legacyCategory: "Food", label: "Food", amountCents: 0 },
    ],
    budgetVersionId: versionId,
    budgetVersion: 3,
    planId,
    sourceBaselineId: null,
    currency: "USD",
    month: "2026-10",
    period: { from: "2026-10-01", through: "2026-10-31", timezone: "UTC" },
    originalApproval: { approvedAt: stamp.toISOString(), actorId: ownerId, actorType: "connector" },
  };
  const qualification = {
    id: qualificationId,
    snapshot,
    confirmedAt: stamp,
    confirmedByActorId: ownerId,
    qualificationKind: "retrospective",
  };
  const rows: unknown[][] = [[version]];
  const findQualification = vi.fn(async (): Promise<unknown> => undefined);
  const findDesignation = vi.fn(async (): Promise<unknown> => undefined);
  const tx = {
    query: {
      financeBudgetBaselineQualifications: { findFirst: findQualification },
      financeBudgetPeriodBaselines: { findFirst: findDesignation },
    },
    select: vi.fn(() => {
      const result = Promise.resolve(rows.shift());
      const chain = {
        from: () => chain,
        where: () => Object.assign(result, chain),
        orderBy: () => chain,
        limit: () => result,
      };
      return chain;
    }),
  };
  const transaction = vi.fn(async (work: (tx: unknown) => Promise<unknown>) => work(tx));
  const service = createFinanceBudgetBaselineQualificationService({
    db: { transaction } as never,
    now: () => stamp,
  });
  return { service, version, qualification, rows, findQualification, findDesignation, transaction };
}
describe("baseline qualification availability", () => {
  it("rejects malformed months before opening a read transaction", async () => {
    const f = fixture();
    await expect(f.service.getQualification(ownerId, "2026-13")).rejects.toThrow();
    expect(f.transaction).not.toHaveBeenCalled();
  });
  it("returns baseline_missing when the owner has no version for the month", async () => {
    const f = fixture();
    f.rows[0] = [];
    await expect(f.service.getQualification(ownerId, "2026-10")).resolves.toEqual({
      state: "unavailable",
      reason: "baseline_missing",
      qualificationRequired: true,
      candidates: [],
    });
  });
  it.each([
    ["no recorded approval", { approvedAt: null }],
    ["unapproved status", { status: "proposed" }],
    ["nonzero deficit", { balanceDelta: 1 }],
    ["resource mismatch", { expectedResources: 101 }],
  ])("withholds an incomplete baseline with %s", async (_label, changes) => {
    const f = fixture();
    Object.assign(f.version, changes);
    await expect(f.service.getQualification(ownerId, "2026-10")).resolves.toMatchObject({
      state: "unavailable",
      reason: "baseline_incomplete",
      candidates: [],
    });
  });
  it("offers the designated period exactly without assuming it has human qualification", async () => {
    const f = fixture();
    f.findDesignation.mockResolvedValue({
      budgetVersionId: versionId,
      periodFrom: "2026-10-01",
      periodThrough: "2026-10-31",
      timezone: "Pacific/Honolulu",
    });
    await expect(f.service.getQualification(ownerId, "2026-10")).resolves.toMatchObject({
      state: "unavailable",
      reason: "qualification_required",
      candidates: [
        {
          budgetVersionId: versionId,
          planId,
          budgetVersion: 3,
          originalActorType: "connector",
          period: { from: "2026-10-01", through: "2026-10-31", timezone: "Pacific/Honolulu" },
        },
      ],
    });
  });
  it("offers an undesignated approved candidate with unknown period rather than selecting one", async () => {
    const f = fixture();
    await expect(f.service.getQualification(ownerId, "2026-10")).resolves.toMatchObject({
      state: "unavailable",
      candidates: [{ budgetVersionId: versionId, period: null }],
    });
  });
  it("withholds historical qualification when an account leaves owner scope", async () => {
    const f = fixture();
    f.findQualification.mockResolvedValue(f.qualification);
    f.rows[0] = [];
    await expect(f.service.getQualification(ownerId, "2026-10")).resolves.toEqual({
      state: "unavailable",
      reason: "scope_unavailable",
      qualificationRequired: true,
      candidates: [],
    });
  });
  it("retains immutable declared currency and zero limit after current account currency changes", async () => {
    const f = fixture();
    f.findQualification.mockResolvedValue(f.qualification);
    f.rows[0] = [{ id: accountId, currency: "EUR" }];
    await expect(f.service.getQualification(ownerId, "2026-10")).resolves.toMatchObject({
      state: "qualified",
      qualification: {
        id: qualificationId,
        currency: "USD",
        allocations: [{ amountCents: 0 }],
        originalApproval: { actorType: "connector" },
      },
    });
    expect(f.findDesignation).not.toHaveBeenCalled();
  });
});

function confirmationFixture() {
  const f = fixture();
  const reviewId = "66666666-6666-4666-8666-666666666666";
  const fingerprint = "a".repeat(64);
  const review = {
    id: reviewId,
    periodMonth: "2026-10",
    fingerprint,
    sourceFingerprint: "source-a",
    snapshot: f.qualification.snapshot,
  };
  const rows: unknown[][] = [[review]];
  const writes: Array<{ table: string; value: unknown }> = [];
  let failSave = false;
  const tx = {
    query: { financeBudgetBaselineQualifications: { findFirst: f.findQualification } },
    select: () => {
      const chain = { from: () => chain, where: () => chain, for: async () => rows.shift() };
      return chain;
    },
    insert: (table: never) => ({
      values: (value: Record<string, unknown>) => {
        writes.push({ table: getTableName(table), value });
        return { returning: async () => (failSave ? [] : [{ ...value, id: qualificationId }]) };
      },
    }),
  };
  const transaction = vi.fn(async (work: (tx: unknown) => unknown) => work(tx));
  const service = createFinanceBudgetBaselineQualificationService({
    db: { transaction } as never,
    now: () => stamp,
  });
  const context = {
    userId: ownerId,
    actorId: ownerId,
    actorType: "user",
    canMutate: true,
    requestId: "confirm-unit",
  } as const;
  const input = { reviewId, expectedFingerprint: fingerprint, idempotencyKey: "confirm" };
  evidence.prepare.mockReset();
  evidence.prepare.mockResolvedValue({
    snapshot: review.snapshot,
    fingerprint,
    sourceFingerprint: review.sourceFingerprint,
  });
  return {
    ...f,
    tx,
    service,
    review,
    rows,
    writes,
    input,
    context,
    transaction,
    failSave: () => {
      failSave = true;
    },
    confirm: () => service.confirm(input, context as never),
  };
}
describe("exact baseline review confirmation", () => {
  it("rejects a missing review without changing monthly qualification", async () => {
    const f = confirmationFixture();
    f.rows[0] = [];
    await expect(f.confirm()).rejects.toMatchObject({ code: "not_found" });
    expect(f.writes).toEqual([]);
  });
  it("rejects a different displayed fingerprint without writing", async () => {
    const f = confirmationFixture();
    f.input.expectedFingerprint = "b".repeat(64);
    await expect(f.confirm()).rejects.toMatchObject({ code: "conflict" });
    expect(f.writes).toEqual([]);
  });
  it("cannot replace a month already qualified through another review", async () => {
    const f = confirmationFixture();
    f.findQualification.mockResolvedValue({ ...f.qualification, reviewId: planId });
    await expect(f.confirm()).rejects.toMatchObject({ code: "conflict" });
    expect(f.writes).toEqual([]);
  });
  it("replays the same confirmed review without preparing fresh evidence or adding another audit", async () => {
    const f = confirmationFixture();
    f.findQualification.mockResolvedValue({ ...f.qualification, reviewId: f.review.id });
    evidence.prepare.mockClear();
    await expect(f.confirm()).resolves.toMatchObject({
      state: "qualified",
      qualification: { id: qualificationId, currency: "USD" },
    });
    expect(evidence.prepare).not.toHaveBeenCalled();
    expect(f.writes).toEqual([]);
  });
  it.each([
    "fingerprint",
    "sourceFingerprint",
  ] as const)("requires a new review when current %s changes", async (field) => {
    const f = confirmationFixture();
    evidence.prepare.mockResolvedValue({
      snapshot: f.review.snapshot,
      fingerprint: f.review.fingerprint,
      sourceFingerprint: f.review.sourceFingerprint,
      [field]: "changed",
    });
    await expect(f.confirm()).rejects.toMatchObject({ code: "conflict" });
    expect(f.writes).toEqual([]);
  });
  it("reports failed qualification persistence without adding a success audit", async () => {
    const f = confirmationFixture();
    f.failSave();
    await expect(f.confirm()).rejects.toMatchObject({ code: "internal_error" });
    expect(f.writes).toHaveLength(1);
  });
  it("records the exact reviewed snapshot and canonical human actor with one audit", async () => {
    const f = confirmationFixture();
    await expect(f.confirm()).resolves.toMatchObject({
      state: "qualified",
      qualification: {
        confirmedByActorId: ownerId,
        qualificationKind: "retrospective",
        allocations: [{ amountCents: 0 }],
      },
    });
    expect(evidence.prepare).toHaveBeenCalledExactlyOnceWith(f.tx, ownerId, {
      accountIds: [accountId],
      budgetVersionId: versionId,
      currency: "USD",
      month: "2026-10",
      timezone: "UTC",
    });
    expect(f.writes.map((write) => write.table)).toEqual([
      "finance_budget_baseline_qualifications",
      "audit_events",
    ]);
    expect(f.writes[0]?.value).toMatchObject({
      reviewId: f.review.id,
      fingerprint: f.review.fingerprint,
      snapshot: f.review.snapshot,
      confirmedByActorId: ownerId,
    });
  });
});
describe("baseline review preparation persistence", () => {
  const input = {
    accountIds: [accountId],
    budgetVersionId: versionId,
    currency: "USD",
    month: "2026-10",
    timezone: "UTC",
    idempotencyKey: "prepare",
  };
  it("does not report a review or audit when the review insert returns no row", async () => {
    const f = confirmationFixture();
    f.failSave();
    await expect(f.service.prepare(input, f.context as never)).rejects.toMatchObject({
      code: "internal_error",
    });
    expect(f.writes).toHaveLength(1);
  });
  it("returns the exact prepared evidence and records its review audit", async () => {
    const f = confirmationFixture();
    await expect(f.service.prepare(input, f.context as never)).resolves.toMatchObject({
      id: qualificationId,
      fingerprint: f.review.fingerprint,
      snapshot: f.review.snapshot,
    });
    expect(evidence.prepare).toHaveBeenCalledExactlyOnceWith(f.tx, ownerId, input);
    expect(f.writes.map((write) => write.table)).toEqual([
      "finance_budget_baseline_reviews",
      "audit_events",
    ]);
    expect(f.writes[0]?.value).toMatchObject({
      userId: ownerId,
      budgetVersionId: versionId,
      planId,
      periodMonth: "2026-10",
      sourceFingerprint: f.review.sourceFingerprint,
    });
  });
});
