import { getTableName } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { createFinanceBalanceBasisService } from "./balance-basis-service.js";

// Unit tests isolate the statement's evidence checks. Idempotency and lock
// serialization remain covered by the PostgreSQL suites, not this adapter.
vi.mock("./context.js", async (original) => ({
  ...(await original<typeof import("./context.js")>()),
  executeFinanceIdempotently: async (
    db: { transaction: (work: unknown) => unknown },
    _context: unknown,
    _options: unknown,
    work: unknown,
  ) => db.transaction(work),
}));
vi.mock("../finance-reimbursement-locks.js", () => ({ lockReimbursementTopology: vi.fn() }));
const ownerId = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
const basisId = "33333333-3333-4333-8333-333333333333";
const transactionId = "44444444-4444-4444-8444-444444444444";
const stamp = new Date("2026-10-18T12:00:00Z");
function fixture() {
  const account = { id: accountId, kind: "cash", contextualRevision: 7n, currencyCode: "USD" };
  const movement = {
    id: transactionId,
    contextualRevision: 9n,
    reimbursementRelationshipRevision: 10n,
  };
  const rows: Record<string, unknown[]> = {
    finance_accounts: [account],
    finance_cash_balance_bases: [],
    finance_transactions: [movement],
  };
  let missingSaved = false;
  const writes: Array<{ table: string; value: unknown }> = [];
  const tx = {
    select: () => {
      let table = "";
      const promise = () => Promise.resolve(rows[table]);
      const chain = {
        from: (target: never) => {
          table = getTableName(target);
          return chain;
        },
        where: () => chain,
        orderBy: () => chain,
        limit: () => Object.assign(promise(), { for: promise }),
      };
      return chain;
    },
    insert: (target: never) => ({
      values: (value: Record<string, unknown> | Array<Record<string, unknown>>) => {
        const table = getTableName(target);
        writes.push({ table, value });
        return {
          returning: async () =>
            missingSaved ? [] : Array.isArray(value) ? value : [{ ...value, id: basisId }],
        };
      },
    }),
  };
  const service = createFinanceBalanceBasisService({
    db: { transaction: async (work: (tx: unknown) => unknown) => work(tx) } as never,
    now: () => stamp,
    readOccurrences: vi.fn(),
  });
  const input = {
    accountId,
    expectedAccountRevision: "7",
    expectedBasisRevision: 0,
    kind: "current" as const,
    amountCents: 1000,
    currencyCode: "USD",
    asOf: "2026-10-18T11:00:00Z",
    validUntil: "2026-10-19T11:00:00Z",
    protectedFloorCents: null,
    reflections: [
      {
        transactionId,
        transactionRevision: "9",
        reimbursementRelationshipRevision: "10",
        reflection: "included" as const,
      },
    ],
    idempotencyKey: "statement",
  };
  const context = {
    userId: ownerId,
    actorId: ownerId,
    actorType: "user",
    canMutate: true,
    requestId: "unit-statement",
  } as const;
  return {
    account,
    movement,
    rows,
    writes,
    input,
    context,
    service,
    missingSave: () => {
      missingSaved = true;
    },
    confirm: () => service.confirmFinanceBalanceBasis(input, context as never),
  };
}
describe("explicit balance statement evidence", () => {
  it.each([
    [
      "missing account",
      (f: ReturnType<typeof fixture>) => {
        f.rows.finance_accounts = [];
      },
      "not_found",
    ],
    [
      "noncash account",
      (f: ReturnType<typeof fixture>) => {
        f.account.kind = "credit";
      },
      "conflict",
    ],
    [
      "changed account revision",
      (f: ReturnType<typeof fixture>) => {
        f.account.contextualRevision = 8n;
      },
      "conflict",
    ],
    [
      "currency mismatch",
      (f: ReturnType<typeof fixture>) => {
        f.account.currencyCode = "EUR";
      },
      "invalid_request",
    ],
    [
      "newer statement",
      (f: ReturnType<typeof fixture>) => {
        f.rows.finance_cash_balance_bases = [{ basisRevision: 1 }];
      },
      "conflict",
    ],
    [
      "missing listed movement",
      (f: ReturnType<typeof fixture>) => {
        f.rows.finance_transactions = [];
      },
      "conflict",
    ],
    [
      "unreviewed extra movement",
      (f: ReturnType<typeof fixture>) => {
        f.rows.finance_transactions = [f.movement, { ...f.movement, id: basisId }];
      },
      "conflict",
    ],
    [
      "oversized history",
      (f: ReturnType<typeof fixture>) => {
        f.rows.finance_transactions = Array.from({ length: 1001 }, () => f.movement);
      },
      "conflict",
    ],
    [
      "changed transaction revision",
      (f: ReturnType<typeof fixture>) => {
        f.movement.contextualRevision = 11n;
      },
      "conflict",
    ],
    [
      "changed reimbursement relationship",
      (f: ReturnType<typeof fixture>) => {
        f.movement.reimbursementRelationshipRevision = 11n;
      },
      "conflict",
    ],
    [
      "different transaction identity",
      (f: ReturnType<typeof fixture>) => {
        f.movement.id = basisId;
      },
      "conflict",
    ],
  ] as const)("rejects %s without writing a statement or audit", async (_label, change, code) => {
    const f = fixture();
    change(f);
    await expect(f.confirm()).rejects.toMatchObject({ code });
    expect(f.writes).toEqual([]);
  });
  it("reports a failed insert without publishing reflections or an audit", async () => {
    const f = fixture();
    f.missingSave();
    await expect(f.confirm()).rejects.toMatchObject({ code: "internal_error" });
    expect(f.writes.map((write) => write.table)).toEqual(["finance_cash_balance_bases"]);
  });
  it("records explicit zero and exact revised reflection evidence after a prior statement", async () => {
    const f = fixture();
    f.rows.finance_cash_balance_bases = [{ basisRevision: 2 }];
    f.input.expectedBasisRevision = 2;
    f.input.amountCents = 0;
    await expect(f.confirm()).resolves.toMatchObject({
      outcome: "completed",
      data: {
        basisRevision: 3,
        amountCents: 0,
        reflections: [
          {
            transactionId,
            transactionRevision: "9",
            reimbursementRelationshipRevision: "10",
            reflection: "included",
          },
        ],
      },
    });
    expect(f.writes.map((write) => write.table)).toEqual([
      "finance_cash_balance_bases",
      "finance_balance_inclusions",
      "audit_events",
    ]);
  });
  it("records an empty history without inventing reflections when account currency is unknown", async () => {
    const f = fixture();
    Object.assign(f.account, { currencyCode: null });
    f.rows.finance_transactions = [];
    f.input.reflections = [];
    await expect(f.confirm()).resolves.toMatchObject({
      outcome: "completed",
      data: { currencyCode: "USD", reflections: [] },
    });
    expect(f.writes.map((write) => write.table)).toEqual([
      "finance_cash_balance_bases",
      "audit_events",
    ]);
  });
});
