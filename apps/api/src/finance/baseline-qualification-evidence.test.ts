import type { FinanceBudgetBaselineSnapshot } from "@personal-os/domain";
import {
  baselinePeriod,
  baselineQualificationKind,
  prepareBaselineEvidence,
} from "./baseline-qualification-evidence.js";
import { createFinanceBudgetBaselineQualificationService } from "./baseline-qualification-service.js";

describe("baseline qualification evidence", () => {
  it("uses complete calendar months, including leap day", () => {
    expect(baselinePeriod("2024-02", "America/New_York")).toEqual({
      from: "2024-02-01",
      through: "2024-02-29",
      timezone: "America/New_York",
    });
    expect(baselinePeriod("2026-12", "UTC").through).toBe("2026-12-31");
  });
  it("discloses retrospective confirmation using the reviewed timezone and original actor", () => {
    const snapshot = {
      month: "2026-10",
      period: { timezone: "America/Los_Angeles" },
      originalApproval: { actorType: "user", actorId: "owner" },
    } as FinanceBudgetBaselineSnapshot;
    const now = new Date("2026-11-01T03:00:00Z");
    expect(baselineQualificationKind(snapshot, now, "owner")).toBe("current");
    expect(
      baselineQualificationKind(
        { ...snapshot, period: { ...snapshot.period, timezone: "UTC" } },
        now,
        "owner",
      ),
    ).toBe("retrospective");
    expect(
      baselineQualificationKind(
        { ...snapshot, originalApproval: { ...snapshot.originalApproval, actorType: "agent" } },
        now,
        "owner",
      ),
    ).toBe("retrospective");
  });
  it.each([
    { actorType: "agent", actorId: "agent" },
    { actorType: "user", actorId: "other" },
  ] as const)("rejects unauthorized confirmation before any durable mutation", async ({
    actorType,
    actorId,
  }) => {
    const transaction = vi.fn();
    const service = createFinanceBudgetBaselineQualificationService({
      db: { transaction } as never,
      now: () => new Date(),
    });
    await expect(
      service.confirm(
        {},
        {
          actorType,
          actorId,
          userId: "owner",
          canMutate: true,
          canSelfApprove: true,
          bypassEnabled: true,
          requestId: "forbidden",
        },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(transaction).not.toHaveBeenCalled();
  });
});

// These rows model the historical evidence boundary without starting PostgreSQL.
function evidenceFixture() {
  const id = "11111111-1111-4111-8111-111111111111";
  const categoryId = "22222222-2222-4222-8222-222222222222";
  const versionId = "33333333-3333-4333-8333-333333333333";
  const planId = "44444444-4444-4444-8444-444444444444";
  const designationId = "55555555-5555-4555-8555-555555555555";
  const accountId = "66666666-6666-4666-8666-666666666666";
  const allocationId = "77777777-7777-4777-8777-777777777777";
  const stamp = new Date("2026-10-01T00:00:00Z");
  const version = {
    id: versionId,
    userId: id,
    planId,
    version: 1,
    effectiveFrom: "2026-10",
    status: "retired",
    approvedAt: stamp,
    approvedByActorId: id,
    approvedByActorType: "user",
    balanceDelta: 0,
    expectedResources: 100,
    allocatedTotal: 100,
    resources: [{ amount: 100 }],
    createdAt: stamp,
    updatedAt: stamp,
  };
  const allocation = {
    id: allocationId,
    allocationKey: "food",
    categoryId,
    legacyCategory: null,
    kind: "spending",
    amount: 100,
    createdAt: stamp,
    updatedAt: stamp,
  };
  const account = { id: accountId, currencyCode: "USD", updatedAt: stamp };
  const category = { id: categoryId, name: "Food", createdAt: stamp, updatedAt: stamp };
  const rows: unknown[][] = [[version], [], [allocation], [account], [category]];
  const tx = {
    select: vi.fn(() => {
      const result = Promise.resolve(rows.shift());
      const chain = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        for: () => result,
      };
      return chain;
    }),
  };
  const input = {
    budgetVersionId: versionId,
    accountIds: [accountId],
    currency: "USD",
    month: "2026-10",
    timezone: "UTC",
  };
  return {
    id,
    versionId,
    planId,
    designationId,
    accountId,
    allocationId,
    categoryId,
    stamp,
    version,
    allocation,
    account,
    category,
    rows,
    tx,
    input,
    read: () => prepareBaselineEvidence(tx as never, id, input),
  };
}
it("preserves designated historical identity and fingerprints source changes separately from reviewed amounts", async () => {
  const f = evidenceFixture();
  f.rows[1] = [
    {
      id: f.designationId,
      budgetVersionId: f.versionId,
      planId: f.planId,
      periodFrom: "2026-10-01",
      periodThrough: "2026-10-31",
      timezone: "UTC",
      confirmedAt: f.stamp,
    },
  ];
  const result = await f.read();
  expect(result.snapshot).toMatchObject({
    sourceBaselineId: f.designationId,
    budgetVersionId: f.versionId,
    planId: f.planId,
    accountIds: [f.accountId],
    allocations: [{ label: "Food", amountCents: 100 }],
    originalApproval: { actorType: "user", actorId: f.id },
  });
  const changed = evidenceFixture();
  changed.rows[1] = [
    {
      id: changed.designationId,
      budgetVersionId: changed.versionId,
      planId: changed.planId,
      periodFrom: "2026-10-01",
      periodThrough: "2026-10-31",
      timezone: "UTC",
      confirmedAt: changed.stamp,
    },
  ];
  changed.account.updatedAt = new Date("2026-10-02T00:00:00Z");
  const newer = await changed.read();
  expect(newer.fingerprint).toBe(result.fingerprint);
  expect(newer.sourceFingerprint).not.toBe(result.sourceFingerprint);
});
it("accepts explicit legacy category evidence and unknown account currency without inventing category IDs", async () => {
  const f = evidenceFixture();
  Object.assign(f.allocation, { categoryId: null, legacyCategory: "Historical food" });
  Object.assign(f.account, { currencyCode: null });
  const result = await f.read();
  expect(result.snapshot.allocations).toEqual([
    {
      key: "food",
      categoryId: null,
      legacyCategory: "Historical food",
      label: "Historical food",
      amountCents: 100,
    },
  ]);
  expect(result.snapshot.currency).toBe("USD");
  expect(f.tx.select).toHaveBeenCalledTimes(4);
});
it.each([
  [
    "missing owner version",
    (f: ReturnType<typeof evidenceFixture>) => {
      f.rows[0] = [];
    },
    "not_found",
  ],
  [
    "wrong month",
    (f: ReturnType<typeof evidenceFixture>) => {
      f.version.effectiveFrom = "2026-09";
    },
    "conflict",
  ],
  [
    "unapproved proposal",
    (f: ReturnType<typeof evidenceFixture>) => {
      f.version.status = "proposed";
    },
    "conflict",
  ],
  [
    "missing approval",
    (f: ReturnType<typeof evidenceFixture>) => {
      Object.assign(f.version, { approvedAt: null });
    },
    "conflict",
  ],
  [
    "unbalanced version",
    (f: ReturnType<typeof evidenceFixture>) => {
      f.version.balanceDelta = 1;
    },
    "conflict",
  ],
  [
    "inconsistent totals",
    (f: ReturnType<typeof evidenceFixture>) => {
      f.version.expectedResources = 101;
    },
    "conflict",
  ],
  [
    "different designated version",
    (f: ReturnType<typeof evidenceFixture>) => {
      f.rows[1] = [{ budgetVersionId: f.categoryId }];
    },
    "conflict",
  ],
  [
    "empty allocations",
    (f: ReturnType<typeof evidenceFixture>) => {
      f.rows[2] = [];
    },
    "conflict",
  ],
  [
    "empty resources",
    (f: ReturnType<typeof evidenceFixture>) => {
      f.version.resources = [];
    },
    "conflict",
  ],
  [
    "allocation total drift",
    (f: ReturnType<typeof evidenceFixture>) => {
      f.allocation.amount = 99;
    },
    "conflict",
  ],
  [
    "resource total drift",
    (f: ReturnType<typeof evidenceFixture>) => {
      f.version.resources = [{ amount: 99 }];
    },
    "conflict",
  ],
  [
    "foreign account selection",
    (f: ReturnType<typeof evidenceFixture>) => {
      f.rows[3] = [];
    },
    "not_found",
  ],
  [
    "known currency mismatch",
    (f: ReturnType<typeof evidenceFixture>) => {
      f.account.currencyCode = "EUR";
    },
    "invalid_request",
  ],
  [
    "no spending allocation",
    (f: ReturnType<typeof evidenceFixture>) => {
      f.allocation.kind = "buffer";
    },
    "conflict",
  ],
  [
    "lost historical category",
    (f: ReturnType<typeof evidenceFixture>) => {
      f.rows[4] = [];
    },
    "conflict",
  ],
  [
    "no category identity",
    (f: ReturnType<typeof evidenceFixture>) => {
      Object.assign(f.allocation, { categoryId: null });
    },
    "conflict",
  ],
] as const)("withholds qualification for %s", async (_label, change, code) => {
  const f = evidenceFixture();
  change(f);
  await expect(f.read()).rejects.toMatchObject({ code });
});
