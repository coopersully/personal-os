import {
  auditEvents,
  type Database,
  financeAccounts,
  financeIncomeStreams,
  financeRecurringObligations,
  financeRecurringScheduleVersions,
} from "@personal-os/database";
import type { ConfirmFinanceRecurringScheduleInput } from "@personal-os/domain";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { expect, it, vi } from "vitest";
import { createFinanceBalanceBasisService } from "./balance-basis-service.js";
import type { FinanceMutationContext } from "./context.js";
import { createFinanceRecurringOccurrenceService } from "./recurring-occurrence-service.js";
import { createFinanceRecurringScheduleService } from "./recurring-schedule-service.js";

const id = "f2000000-0000-4000-8000-000000000001";
const now = () => new Date("2026-03-01T12:00:00Z");
const context: FinanceMutationContext = {
  userId: id,
  actorId: "agent",
  actorType: "agent",
  canMutate: true,
  canSelfApprove: true,
  bypassEnabled: true,
  requestId: "guard",
};
const db = {} as Database;
it("requires human schedule authority before reading an idempotency receipt", async () => {
  const service = createFinanceRecurringScheduleService({ db, now });
  await expect(
    service.confirmFinanceRecurringSchedule(
      {
        source: { kind: "income", id },
        accountId: id,
        cadence: "monthly",
        timezone: "UTC",
        anchorLocalDate: "2026-01-31",
        effectiveFrom: "2026-03-01",
        semimonthlyDays: null,
        amountBasis: "fixed",
        amountCents: 10000,
        currencyCode: "USD",
        expectedSourceRevision: 1,
        supersedesId: null,
        idempotencyKey: "prior-human",
      },
      context,
    ),
  ).rejects.toMatchObject({ code: "forbidden" });
});
it("requires human match/reversal authority before any topology or receipt lookup", async () => {
  const service = createFinanceRecurringOccurrenceService({ db, now });
  await expect(
    service.manageFinanceOccurrenceMatch(
      {
        operation: "reverse",
        matchId: id,
        rationale: "Explicit reversal",
        idempotencyKey: "prior-human",
      },
      context,
    ),
  ).rejects.toMatchObject({ code: "forbidden" });
});
it("does not let an agent turn a balance statement into financial authority", async () => {
  const service = createFinanceBalanceBasisService({
    db,
    now,
    readOccurrences: async () => ({
      from: "2026-03-01",
      to: "2026-03-31",
      occurrences: [],
      matchEvents: [],
      unavailableSources: [],
    }),
  });
  await expect(
    service.confirmFinanceBalanceBasis(
      {
        accountId: id,
        kind: "current",
        amountCents: 10000,
        currencyCode: "USD",
        asOf: "2026-03-01T00:00:00Z",
        validUntil: "2026-03-31T00:00:00Z",
        protectedFloorCents: null,
        reflections: [],
        expectedAccountRevision: "1",
        expectedBasisRevision: 0,
        idempotencyKey: "prior-human",
      },
      context,
    ),
  ).rejects.toMatchObject({ code: "forbidden" });
});

// Unit boundary: execute the existing callback; receipts/rollback and row locks need PG proof.
const boundary = vi.hoisted(() => ({ execute: vi.fn(), lock: vi.fn() }));
vi.mock("./context.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./context.js")>()),
  executeFinanceIdempotently: boundary.execute,
}));
vi.mock("../finance-reimbursement-locks.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../finance-reimbursement-locks.js")>()),
  lockReimbursementTopology: boundary.lock,
}));
const sourceId = "f2000000-0000-4000-8000-000000000002";
const versionId = "f2000000-0000-4000-8000-000000000003";
const human: FinanceMutationContext = { ...context, actorType: "user", actorId: id };
function statement(
  changes: Partial<ConfirmFinanceRecurringScheduleInput> = {},
): ConfirmFinanceRecurringScheduleInput {
  return {
    source: { kind: "income", id: sourceId },
    accountId: id,
    expectedSourceRevision: 1,
    cadence: "monthly",
    timezone: "UTC",
    anchorLocalDate: "2026-01-31",
    effectiveFrom: "2026-03-01",
    semimonthlyDays: null,
    amountBasis: "fixed",
    amountCents: 10000,
    currencyCode: "EUR",
    supersedesId: null,
    idempotencyKey: "explicit-user",
    ...changes,
  };
}
function savedVersion(changes: Record<string, unknown> = {}) {
  return {
    id: versionId,
    userId: id,
    actorUserId: id,
    recordedAt: now(),
    incomeStreamId: sourceId,
    obligationId: null,
    sourceRevision: 2,
    accountId: id,
    cadence: "monthly",
    timezone: "UTC",
    anchorLocalDate: "2026-01-31",
    effectiveFrom: "2026-03-01",
    semimonthlyDays: null,
    amountCents: 10000,
    amountBasis: "fixed",
    currencyCode: "EUR",
    supersedesId: null,
    ...changes,
  };
}
function harness(options: { reads?: unknown[][]; updateRows?: unknown[]; save?: boolean } = {}) {
  const reads = [
    ...(options.reads ?? [
      [{ currencyCode: "EUR" }],
      [{ id: sourceId, status: "active", revision: 1, accountId: id }],
      [],
      [],
    ]),
  ];
  const predicates: Array<{ table: unknown; query: SQL }> = [];
  const limits: number[] = [];
  const inserted: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  function chain(rows: unknown[], table?: unknown) {
    const value = Promise.resolve(rows);
    return Object.assign(value, {
      from: vi.fn((next: unknown) => {
        table = next;
        return value;
      }),
      where: vi.fn((query: SQL) => {
        predicates.push({ table, query });
        return value;
      }),
      orderBy: vi.fn(() => value),
      limit: vi.fn((count: number) => {
        limits.push(count);
        return value;
      }),
      for: vi.fn(() => value),
      innerJoin: vi.fn(() => value),
      returning: vi.fn(() => Promise.resolve(rows)),
    });
  }
  const updateSet = vi.fn((_values: Record<string, unknown>) => {
    const result = chain(options.updateRows ?? [{ revision: 2 }]);
    return result;
  });
  const tx = {
    select: vi.fn(() => chain(reads.shift() ?? [])),
    update: vi.fn(() => ({ set: updateSet })),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: Record<string, unknown>) => {
        inserted.push({ table, values });
        return chain(
          table === financeRecurringScheduleVersions
            ? options.save === false
              ? []
              : [savedVersion(values)]
            : [],
        );
      }),
    })),
  };
  boundary.execute.mockImplementation(
    async (
      _db: unknown,
      _context: unknown,
      _input: unknown,
      work: (tx: unknown) => Promise<unknown>,
    ) => work(tx),
  );
  boundary.lock.mockResolvedValue(undefined);
  const database = {
    selectDistinctOn: vi.fn(() => chain(reads.shift() ?? [])),
  } as unknown as Database;
  return {
    service: createFinanceRecurringScheduleService({ db: database, now }),
    tx,
    database,
    predicates,
    limits,
    inserted,
    updateSet,
  };
}
function source(status = "active", changes: Record<string, unknown> = {}) {
  return { id: sourceId, status, revision: 1, accountId: id, ...changes };
}
function readsBeforeSource(row: unknown[] = [source()]) {
  return [[{ currencyCode: "EUR" }], row];
}
function expectNoWrites(f: ReturnType<typeof harness>) {
  expect(f.tx.update).not.toHaveBeenCalled();
  expect(f.tx.insert).not.toHaveBeenCalled();
}

it.each([
  "income",
  "obligation",
] as const)("records an explicit %s schedule, atomically advances its source and audits the resulting version", async (kind) => {
  const f = harness();
  const input = statement({ source: { kind, id: sourceId } });
  const result = await f.service.confirmFinanceRecurringSchedule(input, human);
  expect(result).toMatchObject({
    schemaVersion: 1,
    outcome: "completed",
    data: {
      source: input.source,
      sourceRevision: 2,
      amountCents: 10000,
      currencyCode: "EUR",
      recordedAt: now().toISOString(),
    },
  });
  expect(f.tx.update).toHaveBeenCalledWith(
    kind === "income" ? financeIncomeStreams : financeRecurringObligations,
  );
  expect(f.updateSet.mock.calls[0]?.[0]).toMatchObject({ updatedAt: now() });
  const set = f.updateSet.mock.calls[0]?.[0] as unknown as { revision: SQL };
  expect(new PgDialect().sqlToQuery(set.revision).sql).toContain('"revision" + 1');
  expect(f.inserted.map((row) => row.table)).toEqual([
    financeRecurringScheduleVersions,
    auditEvents,
  ]);
  expect(f.inserted[0]?.values).toMatchObject({
    actorUserId: id,
    userId: id,
    sourceRevision: 2,
    incomeStreamId: kind === "income" ? sourceId : null,
    obligationId: kind === "obligation" ? sourceId : null,
  });
  expect(f.inserted[1]?.values).toMatchObject({
    action: "finance.recurring_schedule.confirmed",
    entityId: sourceId,
    before: { versionId: null, revision: 1 },
    after: { versionId, revision: 2, effectiveFrom: input.effectiveFrom },
  });
  const ownerQueries = f.predicates.filter((row) =>
    [financeAccounts, financeIncomeStreams, financeRecurringObligations].includes(
      row.table as never,
    ),
  );
  for (const predicate of ownerQueries)
    expect(new PgDialect().sqlToQuery(predicate.query).params).toContain(id);
  expect(boundary.lock).toHaveBeenCalledWith(f.tx, id);
  expect(boundary.execute).toHaveBeenLastCalledWith(
    expect.anything(),
    human,
    expect.objectContaining({
      operation: "finance.recurring.schedule.confirm",
      idempotencyKey: input.idempotencyKey,
      lockIdentities: [`finance-reimbursement-topology:${id}`],
    }),
    expect.any(Function),
  );
});
it("preserves explicit currency when an owned account's currency is unknown and normalizes semimonthly slots", async () => {
  const f = harness({ reads: [[{ currencyCode: null }], [source("needs_review")], [], []] });
  const result = await f.service.confirmFinanceRecurringSchedule(
    statement({ cadence: "semimonthly", semimonthlyDays: [31, 15] }),
    human,
  );
  expect(result.data).toMatchObject({ currencyCode: "EUR", semimonthlyDays: [15, 31] });
});
it("supports an unlinked source without looking up an account or inventing account currency", async () => {
  const f = harness({ reads: [[source("active", { accountId: null })], [], []] });
  expect(
    (await f.service.confirmFinanceRecurringSchedule(statement({ accountId: null }), human)).data
      .accountId,
  ).toBeNull();
  expect(f.predicates.some((row) => row.table === financeAccounts)).toBe(false);
});

it.each([
  ["missing/foreign account", [[]], "not_found"],
  ["account currency mismatch", [[{ currencyCode: "USD" }]], "invalid_request"],
  ["missing/foreign source", readsBeforeSource([]), "not_found"],
  ["paused source", readsBeforeSource([source("paused")]), "conflict"],
  ["cancelled source", readsBeforeSource([source("cancelled")]), "conflict"],
  ["stale source revision", readsBeforeSource([source("active", { revision: 2 })]), "conflict"],
  [
    "changed source account",
    readsBeforeSource([source("active", { accountId: null })]),
    "conflict",
  ],
] as const)("rejects %s before writes", async (_label, reads, code) => {
  const f = harness({ reads: reads.map((rows) => [...rows]) });
  await expect(f.service.confirmFinanceRecurringSchedule(statement(), human)).rejects.toMatchObject(
    { code },
  );
  expectNoWrites(f);
  for (const predicate of f.predicates)
    expect(new PgDialect().sqlToQuery(predicate.query).params).toContain(id);
});
it("rejects invalid explicit schedule data before entering a transaction", async () => {
  const f = harness();
  boundary.execute.mockClear();
  await expect(
    f.service.confirmFinanceRecurringSchedule(statement({ currencyCode: "XAU" }), human),
  ).rejects.toThrow();
  expect(boundary.execute).not.toHaveBeenCalled();
  expectNoWrites(f);
});
it.each([
  "wrong predecessor",
  "same boundary",
  "earlier boundary",
])("rejects a successor with %s", async (scenario) => {
  const previous = savedVersion({ effectiveFrom: "2026-02-01" });
  const f = harness({ reads: [...readsBeforeSource(), [previous]] });
  const input = statement({
    supersedesId: scenario === "wrong predecessor" ? null : versionId,
    effectiveFrom:
      scenario === "same boundary"
        ? "2026-02-01"
        : scenario === "earlier boundary"
          ? "2026-01-01"
          : "2026-03-01",
  });
  await expect(f.service.confirmFinanceRecurringSchedule(input, human)).rejects.toMatchObject({
    code: "conflict",
  });
  expectNoWrites(f);
});
it.each([
  "schedule",
  "match",
])("fails closed when %s history exceeds its bounded read", async (kind) => {
  const previous = savedVersion({ effectiveFrom: "2026-02-01" });
  const prior =
    kind === "schedule"
      ? Array.from({ length: 1001 }, () => ({ id: versionId }))
      : [{ id: versionId }];
  const f = harness({
    reads: [
      ...readsBeforeSource(),
      [previous],
      prior,
      Array.from({ length: 1001 }, () => ({ id: "match" })),
    ],
  });
  await expect(
    f.service.confirmFinanceRecurringSchedule(statement({ supersedesId: versionId }), human),
  ).rejects.toMatchObject({ code: "conflict" });
  expectNoWrites(f);
  expect(f.limits).toContain(1001);
});
it("requires every affected original match to be reversed before changing its interval", async () => {
  const f = harness({
    reads: [
      ...readsBeforeSource(),
      [],
      [{ id: versionId }],
      [{ id: "match-a" }, { id: "match-b" }],
      [{ original: "match-a" }],
    ],
  });
  await expect(f.service.confirmFinanceRecurringSchedule(statement(), human)).rejects.toMatchObject(
    { code: "conflict" },
  );
  expectNoWrites(f);
});
it.each([
  false,
  true,
])("allows a successor after affected match history is safely resolved (matches=%s)", async (hasMatches) => {
  const previous = savedVersion({ effectiveFrom: "2026-02-01" });
  const f = harness({
    reads: [
      ...readsBeforeSource(),
      [previous],
      [{ id: versionId }],
      hasMatches ? [{ id: "match-a" }] : [],
      [{ original: "match-a" }],
    ],
  });
  expect(
    (await f.service.confirmFinanceRecurringSchedule(statement({ supersedesId: versionId }), human))
      .data.supersedesId,
  ).toBe(versionId);
});
it("detects a lost source compare-and-swap without appending evidence or an audit", async () => {
  const f = harness({ updateRows: [] });
  await expect(f.service.confirmFinanceRecurringSchedule(statement(), human)).rejects.toMatchObject(
    { code: "conflict" },
  );
  expect(f.tx.update).toHaveBeenCalledOnce();
  expect(f.tx.insert).not.toHaveBeenCalled();
  const predicate = f.predicates.at(-1);
  if (!predicate) throw new Error("Missing CAS predicate");
  expect(new PgDialect().sqlToQuery(predicate.query).params).toEqual([id, sourceId, 1]);
});
it("does not report success or audit when storage fails to return a saved version", async () => {
  const f = harness({ save: false });
  await expect(f.service.confirmFinanceRecurringSchedule(statement(), human)).rejects.toMatchObject(
    { code: "internal_error" },
  );
  expect(f.inserted.some((row) => row.table === auditEvents)).toBe(false);
});
it("lists only the owner's latest source versions, retaining typed variable and obligation facts", async () => {
  const f = harness({
    reads: [
      [
        savedVersion({
          incomeStreamId: null,
          obligationId: sourceId,
          amountBasis: "variable",
          amountCents: null,
        }),
      ],
    ],
  });
  expect(await f.service.listFinanceRecurringSchedules(id)).toMatchObject([
    { source: { kind: "obligation", id: sourceId }, amountBasis: "variable", amountCents: null },
  ]);
  const predicate = f.predicates[0];
  if (!predicate) throw new Error("Missing owner predicate");
  expect(new PgDialect().sqlToQuery(predicate.query).params).toEqual([id]);
  expect(f.limits).toEqual([1001]);
});
it("does not silently truncate an owner's schedule list", async () => {
  const f = harness({ reads: [Array.from({ length: 1001 }, () => savedVersion())] });
  await expect(f.service.listFinanceRecurringSchedules(id)).rejects.toMatchObject({
    code: "conflict",
  });
});
