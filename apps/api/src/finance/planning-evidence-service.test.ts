import {
  type Database,
  financeAccounts,
  financeGoals,
  financePlanningEvidence,
  financeRecurringObligations,
  users,
} from "@personal-os/database";
import { createFinanceService } from "../finance-service.js";
import { createProfileBudgetService } from "./profile-budget-service.js";
import { PgDialect } from "drizzle-orm/pg-core";
import { expect, it, vi } from "vitest";
import type { FinanceMutationContext } from "./context.js";
import {
  createFinancePlanningEvidenceService,
  serializeFinancePlanningEvidence,
} from "./planning-evidence-service.js";

const userId = "f2000000-0000-4000-8000-000000000001";
const sourceId = "f2000000-0000-4000-8000-000000000002";
const accountId = "f2000000-0000-4000-8000-000000000003";
const context: FinanceMutationContext = {
  actorId: userId,
  actorType: "user",
  userId,
  requestId: "evidence-test",
  canMutate: true,
  canSelfApprove: false,
  bypassEnabled: false,
};
const now = () => new Date("2026-03-09T00:15:00Z");
const obligation = {
  id: sourceId,
  userId,
  revision: 3,
  expectedAmount: 12345,
  cadence: "monthly",
  accountId,
  status: "needs_review",
  kind: "bill",
};
const goal = { id: sourceId, userId, version: 4, currentAmount: 0, status: "active" };
const cost = {
  obligationId: sourceId,
  expectedRevision: 3,
  expectedAmountCents: 12345,
  cadence: "monthly" as const,
  accountId,
  currencyCode: "EUR",
  fixedness: "fixed" as const,
  asOf: "2026-03-08",
};
const progress = {
  goalId: sourceId,
  expectedVersion: 4,
  progressAmountCents: 2500,
  currencyCode: "EUR",
  asOf: "2026-03-08",
};
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Supplied-transaction boundary fake: no nested transaction or real database is used. */
function fixture(
  options: {
    source?: Record<string, unknown>;
    accountCurrency?: string | null;
    missingAccount?: boolean;
    missingSource?: boolean;
    casConflict?: boolean;
    timezone?: string;
    evidenceRows?: Array<Record<string, unknown>>;
  } = {},
) {
  const reads: Array<{
    table: unknown;
    query: { sql: string; params: unknown[] };
    lock: string | null;
  }> = [];
  const updates: Array<{
    table: unknown;
    values: Record<string, unknown>;
    query: { sql: string; params: unknown[] };
  }> = [];
  const inserts: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const dialect = new PgDialect();
  const tx = {
    select: vi.fn(() => ({
      from: (table: unknown) => ({
        where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => {
          const read = { table, query: dialect.sqlToQuery(condition), lock: null as string | null };
          reads.push(read);
          const rows =
            table === users
              ? [{ planningTimezone: options.timezone ?? "America/New_York" }]
              : table === financeAccounts
                ? options.missingAccount
                  ? []
                  : [
                      {
                        id: accountId,
                        userId,
                        currencyCode:
                          options.accountCurrency === undefined ? "EUR" : options.accountCurrency,
                      },
                    ]
                : table === financePlanningEvidence
                  ? (options.evidenceRows ?? [])
                  : options.missingSource
                    ? []
                    : [options.source ?? (table === financeGoals ? goal : obligation)];
          return {
            limit: () => ({
              for: async (lock: string) => {
                read.lock = lock;
                return rows;
              },
            }),
            orderBy: async () => rows,
          };
        },
      }),
    })),
    update: vi.fn((table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => {
          updates.push({ table, values, query: dialect.sqlToQuery(condition) });
          return {
            returning: async () =>
              options.casConflict
                ? []
                : [
                    {
                      ...(options.source ?? (table === financeGoals ? goal : obligation)),
                      ...values,
                    },
                  ],
          };
        },
      }),
    })),
    insert: vi.fn((table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserts.push({ table, values });
        return { returning: async () => [values] };
      },
    })),
  } as unknown as Tx;
  (tx as unknown as { selectDistinctOn: unknown }).selectDistinctOn = tx.select;
  return {
    tx,
    reads,
    updates,
    inserts,
    service: createFinancePlanningEvidenceService({ db: tx as unknown as Database, now }),
  };
}

it("locks owned obligation/account and appends resulting-revision evidence and audit in caller transaction", async () => {
  const f = fixture();
  const result = await f.service.confirmObligation({ tx: f.tx, context, input: cost });
  expect(result.source.revision).toBe(4);
  expect(result.evidence).toMatchObject({
    kind: "obligation",
    sourceRevision: 4,
    sourceId,
    expectedAmountCents: 12345,
    accountId,
    currencyCode: "EUR",
    actor: { type: "user", userId },
  });
  expect(f.reads.find((r) => r.table === financeRecurringObligations)).toMatchObject({
    lock: "update",
    query: { params: [userId, sourceId] },
  });
  expect(f.reads.find((r) => r.table === financeAccounts)).toMatchObject({
    lock: "share",
    query: { params: [userId, accountId] },
  });
  expect(f.updates[0]?.query.params).toEqual([userId, sourceId, 3]);
  expect(f.inserts).toHaveLength(2);
  expect(f.inserts[1]?.values).toMatchObject({
    action: "finance.planning_evidence.confirmed",
    userId,
    actorId: userId,
    after: { revision: 4, provenance: "explicit_user" },
  });
});

it("records explicit currency when source currency is unknown without fabricating source data", async () => {
  const f = fixture({ accountCurrency: null });
  expect(
    (await f.service.confirmObligation({ tx: f.tx, context, input: cost })).evidence.currencyCode,
  ).toBe("EUR");
  expect(f.updates[0]?.values).not.toHaveProperty("currencyCode");
});

it.each([
  "agent",
  "system",
  "connector",
] as const)("rejects %s confirmation before database access", async (actorType) => {
  const f = fixture();
  await expect(
    f.service.confirmGoal({
      tx: f.tx,
      context: { ...context, actorType } as FinanceMutationContext,
      input: progress,
    }),
  ).rejects.toMatchObject({ code: "forbidden" });
  expect(f.reads).toHaveLength(0);
  expect(f.inserts).toHaveLength(0);
});

it("rejects missing write authority and user impersonation before reads", async () => {
  for (const invalid of [
    { ...context, canMutate: false },
    { ...context, actorId: sourceId },
  ]) {
    const f = fixture();
    await expect(
      f.service.confirmObligation({ tx: f.tx, context: invalid, input: cost }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(f.reads).toHaveLength(0);
  }
});

it.each([
  { revision: 5 },
  { expectedAmount: 12000 },
  { cadence: "weekly" },
  { accountId: null },
])("rejects changed/ABA obligation binding %j without writes", async (change) => {
  const f = fixture({ source: { ...obligation, ...change } });
  await expect(
    f.service.confirmObligation({ tx: f.tx, context, input: cost }),
  ).rejects.toMatchObject({ code: "conflict" });
  expect(f.updates).toHaveLength(0);
  expect(f.inserts).toHaveLength(0);
});

it.each([
  { status: "paused" },
  { status: "cancelled" },
  { kind: "savings" },
])("rejects ineligible obligation %j", async (change) => {
  const f = fixture({ source: { ...obligation, ...change } });
  await expect(
    f.service.confirmObligation({ tx: f.tx, context, input: cost }),
  ).rejects.toMatchObject({ code: "invalid_request" });
  expect(f.updates).toHaveLength(0);
});

it("rejects a missing/foreign source or unavailable account without leaking or writing", async () => {
  const missing = fixture({ missingSource: true });
  await expect(
    missing.service.confirmGoal({ tx: missing.tx, context, input: progress }),
  ).rejects.toMatchObject({ code: "not_found" });
  expect(missing.reads[1]?.query.params).toEqual([userId, sourceId]);
  const account = fixture({ missingAccount: true });
  await expect(
    account.service.confirmObligation({ tx: account.tx, context, input: cost }),
  ).rejects.toMatchObject({ code: "conflict" });
  expect(account.updates).toHaveLength(0);
});

it("rejects known account currency mismatch without writes", async () => {
  const f = fixture({ accountCurrency: "USD" });
  await expect(
    f.service.confirmObligation({ tx: f.tx, context, input: cost }),
  ).rejects.toMatchObject({ code: "invalid_request" });
  expect(f.updates).toHaveLength(0);
});

it("uses server planning day near midnight and rejects future effective evidence", async () => {
  const f = fixture(); // 00:15Z March9 is March8 in New York.
  await expect(
    f.service.confirmGoal({ tx: f.tx, context, input: { ...progress, asOf: "2026-03-09" } }),
  ).rejects.toMatchObject({ code: "invalid_request" });
  expect(f.updates).toHaveLength(0);
  const invalid = fixture({ timezone: "Unknown/Timezone" });
  await expect(
    invalid.service.confirmGoal({ tx: invalid.tx, context, input: progress }),
  ).rejects.toMatchObject({ code: "invalid_request" });
});

it.each([
  "active",
  "paused",
  "completed",
])("atomically updates %s goal progress and binds resulting version", async (status) => {
  const f = fixture({ source: { ...goal, status } });
  const result = await f.service.confirmGoal({ tx: f.tx, context, input: progress });
  expect(result.source).toMatchObject({ currentAmount: 2500, version: 5 });
  expect(result.evidence).toMatchObject({
    kind: "goal",
    goalId: sourceId,
    goalVersion: 5,
    progressAmountCents: 2500,
    currencyCode: "EUR",
  });
  expect(f.updates[0]?.query.params).toEqual([userId, sourceId, 4]);
});

it("rejects removed or changed goals and CAS races without appending evidence", async () => {
  for (const options of [
    { source: { ...goal, status: "removed" } },
    { source: { ...goal, version: 6 } },
    { casConflict: true },
  ]) {
    const f = fixture(options);
    await expect(
      f.service.confirmGoal({ tx: f.tx, context, input: progress }),
    ).rejects.toBeDefined();
    expect(f.inserts).toHaveLength(0);
  }
});

it.each([
  { progressAmountCents: 2_147_483_648 },
  { progressAmountCents: -1 },
  { progressAmountCents: 1.1 },
  { currencyCode: "JPY" },
  { currencyCode: "XAU" },
  { asOf: "2026-02-30" },
])("validates compatible goal storage and explicit facts %j", async (change) => {
  const f = fixture();
  await expect(
    f.service.confirmGoal({ tx: f.tx, context, input: { ...progress, ...change } }),
  ).rejects.toBeDefined();
  expect(f.reads).toHaveLength(0);
});

it("lists only owner evidence and serializes immutable user provenance", async () => {
  const stored = {
    id: accountId,
    userId,
    actorUserId: userId,
    goalId: sourceId,
    obligationId: null,
    sourceRevision: 5,
    amountCents: 0,
    currencyCode: "EUR",
    fixedness: null,
    boundCadence: null,
    boundAccountId: null,
    asOf: "2026-03-08",
    recordedAt: now(),
  };
  const f = fixture({ evidenceRows: [stored] });
  expect(
    await f.service.listLatestEvidence(userId, { goalIds: [sourceId], obligationIds: [] }),
  ).toEqual([serializeFinancePlanningEvidence(stored)]);
  expect(f.reads[0]?.query.params).toEqual([userId, sourceId]);
});

it("does not query evidence history without requested source identities", async () => {
  const f = fixture();
  expect(await f.service.listLatestEvidence(userId, { goalIds: [], obligationIds: [] })).toEqual(
    [],
  );
  expect(f.reads).toHaveLength(0);
});

it("guards canonical confirmation before idempotency can read or replay a receipt", async () => {
  const db = {} as Database;
  const agent = { ...context, actorType: "agent" as const, actorId: "synthetic-agent" };
  const planning = createProfileBudgetService({ db, now });
  await expect(
    planning.manageFinanceGoal(
      { operation: "confirm_progress", idempotencyKey: "completed-human-key", ...progress },
      agent,
    ),
  ).rejects.toMatchObject({ code: "forbidden" });
  const finances = createFinanceService({ db, now });
  const { obligationId, ...statement } = cost;
  await expect(
    finances.manageFinanceRecurringItem(
      {
        operation: "confirm_cost",
        itemType: "obligation",
        itemId: obligationId,
        idempotencyKey: "completed-human-key",
        ...statement,
      },
      agent,
    ),
  ).rejects.toMatchObject({ code: "forbidden" });
});
