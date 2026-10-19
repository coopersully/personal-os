import type { Database } from "@personal-os/database";
import { financeRecurringOccurrencesQuerySchema, projectPaydayCycle } from "@personal-os/domain";
import { getTableName } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import {
  assertCashflowAccountMayBeDeleted,
  createFinanceBalanceBasisService,
  isIncludedNonRecurringCredit,
  readCashflowActuals,
} from "./balance-basis-service.js";
import type { CashflowTransaction } from "./recurring-schedule-service.js";

const id = "f2000000-0000-4000-8000-000000000001";
function fixture() {
  const tx = {} as CashflowTransaction;
  const transaction = vi.fn(async (work: (tx: CashflowTransaction) => Promise<unknown>) =>
    work(tx),
  );
  const readOccurrences = vi.fn(async (_userId: string, raw: unknown) => {
    const query = financeRecurringOccurrencesQuerySchema.parse(raw);
    return {
      ...query,
      occurrences: [],
      matchEvents: [],
      unavailableSources: [
        { source: { kind: "income" as const, id }, reason: "unconfirmed_schedule" as const },
      ],
    };
  });
  const service = createFinanceBalanceBasisService({
    db: { transaction } as unknown as Database,
    now: () => new Date("2026-03-01T12:00:00Z"),
    readOccurrences,
  });
  return { service, tx, transaction, readOccurrences };
}

it.each([
  id,
  null,
])("maps a projection request with selected income %s to the strict occurrence read", async (selectedIncomeStreamId) => {
  const f = fixture();
  const input = { from: "2026-03-01", to: "2026-03-31", accountIds: [], selectedIncomeStreamId };
  const result = await f.service.getFinanceCashflowProjection(id, input);
  expect(f.readOccurrences).toHaveBeenCalledWith(
    id,
    { from: input.from, to: input.to, accountIds: [] },
    f.tx,
  );
  expect(result.projection).toMatchObject({
    status: "unavailable",
    reasons: [{ code: "unconfirmed_schedule" }],
  });
  expect(input.selectedIncomeStreamId).toBe(selectedIncomeStreamId);
});

it("keeps the projection selection required rather than weakening its public schema", async () => {
  const f = fixture();
  await expect(
    f.service.getFinanceCashflowProjection(id, { from: "2026-03-01", to: "2026-03-31" } as never),
  ).rejects.toThrow();
  expect(f.transaction).not.toHaveBeenCalled();
  expect(f.readOccurrences).not.toHaveBeenCalled();
});

type IncludedCreditInput = Parameters<typeof isIncludedNonRecurringCredit>[0];
function includedCredit(): IncludedCreditInput {
  return {
    userId: id,
    transaction: {
      id,
      userId: id,
      accountId: id,
      direction: "income",
      pending: false,
      contextualRevision: 2n,
      reimbursementRelationshipRevision: 3n,
    },
    actualCurrencyCode: "USD",
    basis: { accountId: id, currencyCode: "USD" },
    reflection: {
      transactionId: id,
      transactionRevision: "2",
      reimbursementRelationshipRevision: "3",
      reflection: "included",
    },
    requiredForOccurrence: false,
    eligibility: { eligible: false, reasons: ["reimbursement_or_refund_credit"] },
  };
}

it.each([
  "repayment",
  "refund",
])("keeps an exactly included %s in opening cash without adding income or a movement", () => {
  const input = includedCredit();
  expect(isIncludedNonRecurringCredit(input)).toBe(true);
  const movements = isIncludedNonRecurringCredit(input)
    ? []
    : [
        {
          id: "excluded-credit",
          version: "credit:2:3",
          localDate: "2026-10-18",
          amountMinorUnits: 200,
          currencyCode: "USD",
          accountId: id,
          direction: "incoming" as const,
          classification: "external_income" as const,
          pairedMovementId: null,
          postingStatus: "posted" as const,
          balanceReflection: "not_included" as const,
        },
      ];
  const result = projectPaydayCycle({
    periodStartLocalDate: "2026-10-18",
    asOfLocalDate: "2026-10-18",
    asOfInstant: "2026-10-18T12:00:00Z",
    selectedIncomeStreamId: id,
    nextPayday: { occurrenceId: "payday", localDate: "2026-10-30", dateBasis: "authoritative" },
    balances: [
      {
        accountId: id,
        accountKind: "cash",
        basis: "current",
        amountMinorUnits: 1000,
        currencyCode: "USD",
        asOfInstant: "2026-10-18T12:00:00Z",
        validUntilInstant: "2026-10-31T00:00:00Z",
        sourceRevision: "statement:1",
        included: true,
        ownershipFraction: 1,
      },
    ],
    occurrences: [
      {
        id: "payday",
        version: "schedule:1",
        localDate: "2026-10-30",
        amountMinorUnits: 500,
        currencyCode: "USD",
        accountId: id,
        direction: "incoming",
        classification: "external_income",
        incomeStreamId: id,
        pairedOccurrenceId: null,
        remainingExpectedMinorUnits: 500,
        matches: [],
      },
    ],
    actualMovements: movements,
  });
  expect(movements).toEqual([]);
  expect(result).toMatchObject({
    status: "estimated",
    openingBalanceMinorUnits: 1000,
    endingBalanceMinorUnits: 1500,
    evidence: { actualMovements: [] },
  });
  expect(input.eligibility).toEqual({
    eligible: false,
    reasons: ["reimbursement_or_refund_credit"],
  });
});

function reflectionOf(input: IncludedCreditInput) {
  if (!input.reflection) throw new Error("Credit fixture requires a reflection");
  return input.reflection;
}

const blockedCreditCases: Array<[string, (input: IncludedCreditInput) => IncludedCreditInput]> = [
  [
    "not included",
    (input) => ({ ...input, reflection: { ...reflectionOf(input), reflection: "not_included" } }),
  ],
  ["missing reflection", (input) => ({ ...input, reflection: undefined })],
  [
    "stale contextual revision",
    (input) => ({ ...input, reflection: { ...reflectionOf(input), transactionRevision: "1" } }),
  ],
  [
    "missing contextual revision",
    (input) => ({ ...input, reflection: { ...reflectionOf(input), transactionRevision: "" } }),
  ],
  [
    "stale relationship generation",
    (input) => ({
      ...input,
      reflection: { ...reflectionOf(input), reimbursementRelationshipRevision: "2" },
    }),
  ],
  [
    "missing relationship generation",
    (input) => ({
      ...input,
      reflection: { ...reflectionOf(input), reimbursementRelationshipRevision: null },
    }),
  ],
  ["pending", (input) => ({ ...input, transaction: { ...input.transaction, pending: true } })],
  ["currency mismatch", (input) => ({ ...input, actualCurrencyCode: "EUR" })],
  ["unknown currency", (input) => ({ ...input, actualCurrencyCode: null })],
  [
    "unclassified",
    (input) => ({
      ...input,
      eligibility: { eligible: false, reasons: ["reimbursement_or_refund_credit", "unclassified"] },
    }),
  ],
  [
    "transfer exclusion",
    (input) => ({
      ...input,
      eligibility: {
        eligible: false,
        reasons: ["reimbursement_or_refund_credit", "transfer_or_card_payment"],
      },
    }),
  ],
  [
    "transfer direction",
    (input) => ({ ...input, transaction: { ...input.transaction, direction: "transfer" } }),
  ],
  ["required occurrence match", (input) => ({ ...input, requiredForOccurrence: true })],
  ["other owner", (input) => ({ ...input, userId: "other" })],
  ["other account", (input) => ({ ...input, basis: { accountId: "other", currencyCode: "USD" } })],
  ["missing basis", (input) => ({ ...input, basis: undefined })],
];
it.each(
  blockedCreditCases,
)("does not waive %s for an included excluded credit", (_label, change) => {
  expect(isIncludedNonRecurringCredit(change(includedCredit()))).toBe(false);
});

function basisReadFixture(rows: unknown[], reflections: unknown[] = []) {
  const query = (result: unknown[]) => {
    const chain = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: vi.fn(async () => result),
    };
    return chain;
  };
  const select = vi.fn(() => query(reflections));
  const db = { selectDistinctOn: vi.fn(() => query(rows)), select };
  const service = createFinanceBalanceBasisService({
    db: db as never,
    now: () => new Date("2026-03-01T12:00:00Z"),
    readOccurrences: vi.fn(),
  });
  return { service, select };
}
it.each([
  undefined,
  [],
])("returns an empty balance history without reading unrelated reflections for scope %j", async (accountIds) => {
  const f = basisReadFixture([]);
  await expect(f.service.listFinanceBalanceBases(id, accountIds)).resolves.toEqual([]);
  expect(f.select).not.toHaveBeenCalled();
});
it("withholds an oversized account history instead of silently projecting a partial balance universe", async () => {
  const f = basisReadFixture(Array.from({ length: 101 }, () => ({ id })));
  await expect(f.service.listFinanceBalanceBases(id)).rejects.toMatchObject({ code: "conflict" });
  expect(f.select).not.toHaveBeenCalled();
});
it("withholds a reflection history that exceeds the bounded read", async () => {
  const f = basisReadFixture(
    [{ id }],
    Array.from({ length: 100001 }, () => ({ basisId: id })),
  );
  await expect(f.service.listFinanceBalanceBases(id, [id])).rejects.toThrow(
    "reflection history exceeds",
  );
});
it("reads only a statement's own exact reflection revisions, retaining unknown relationship evidence", async () => {
  const stamp = new Date("2026-03-01T10:00:00Z");
  const row = {
    id,
    accountId: id,
    basisRevision: 2,
    accountContextualRevision: 9007199254740993n,
    kind: "current",
    amountCents: 0,
    currencyCode: "USD",
    asOf: stamp,
    validUntil: new Date("2026-03-02T10:00:00Z"),
    protectedFloorCents: null,
    actorUserId: id,
    recordedAt: stamp,
  };
  const other = "f2000000-0000-4000-8000-000000000002";
  const f = basisReadFixture(
    [row],
    [
      {
        basisId: id,
        transactionId: id,
        transactionContextualRevision: 9007199254740994n,
        reimbursementRelationshipRevision: null,
        reflection: "included",
      },
      {
        basisId: id,
        transactionId: other,
        transactionContextualRevision: 2n,
        reimbursementRelationshipRevision: 3n,
        reflection: "not_included",
      },
      {
        basisId: other,
        transactionId: other,
        transactionContextualRevision: 1n,
        reflection: "included",
      },
    ],
  );
  await expect(f.service.listFinanceBalanceBases(id, [id])).resolves.toMatchObject([
    {
      accountRevision: "9007199254740993",
      amountCents: 0,
      protectedFloorCents: null,
      reflections: [
        {
          transactionId: id,
          transactionRevision: "9007199254740994",
          reimbursementRelationshipRevision: null,
          reflection: "included",
        },
        {
          transactionId: other,
          transactionRevision: "2",
          reimbursementRelationshipRevision: "3",
          reflection: "not_included",
        },
      ],
    },
  ]);
});
it("rejects an agent's balance confirmation before opening a write transaction", async () => {
  const f = fixture();
  await expect(
    f.service.confirmFinanceBalanceBasis(
      {} as never,
      { actorType: "agent", actorId: id, userId: id } as never,
    ),
  ).rejects.toMatchObject({ code: "forbidden" });
  expect(f.transaction).not.toHaveBeenCalled();
});
it("rejects a future human balance statement before opening a write transaction", async () => {
  const f = fixture();
  await expect(
    f.service.confirmFinanceBalanceBasis(
      {
        accountId: id,
        expectedAccountRevision: "1",
        expectedBasisRevision: 0,
        kind: "current",
        amountCents: 0,
        currencyCode: "USD",
        asOf: "2026-03-02T10:00:00Z",
        validUntil: "2026-03-03T10:00:00Z",
        protectedFloorCents: null,
        reflections: [],
        idempotencyKey: "future-statement",
      },
      { actorType: "user", actorId: id, userId: id, canMutate: true } as never,
    ),
  ).rejects.toMatchObject({ code: "invalid_request" });
  expect(f.transaction).not.toHaveBeenCalled();
});

function actualsFixture() {
  const account = {
    id,
    currencyCode: "USD",
    includeInPlanning: true,
    kind: "cash",
    ownershipShareBps: 10000,
    ownershipType: "individual",
  };
  const movement = {
    id,
    userId: id,
    accountId: id,
    amount: 100,
    category: "FOOD_AND_DRINK",
    currencyCode: "USD",
    direction: "income",
    pending: false,
    pendingTransactionId: null,
    providerDirection: null,
    providerTransactionId: null,
    reconciliationStatus: "not_applicable",
    transactionDate: "2026-10-18",
    transferGroupId: null,
  };
  const allocation = {
    id: "f2000000-0000-4000-8000-000000000002",
    transactionId: id,
    userId: id,
    categoryId: null,
    amount: 100,
    state: "active",
    treatment: "personal",
    revision: 1,
  };
  const rows: Record<string, unknown[]> = {
    finance_accounts: [account],
    finance_transactions: [movement],
    finance_transaction_allocations: [],
    finance_reimbursements: [],
    finance_reimbursement_matches: [],
    finance_transaction_relationships: [],
    finance_economic_events: [],
    finance_recurring_schedule_versions: [],
    finance_cash_balance_bases: [],
  };
  const tx = {
    select: () => {
      let table = "";
      const chain = {
        from: (target: never) => {
          table = getTableName(target);
          return chain;
        },
        where: () => chain,
        orderBy: () => chain,
        limit: async () => rows[table],
      };
      return chain;
    },
  };
  return {
    account,
    movement,
    allocation,
    rows,
    tx,
    read: () =>
      readCashflowActuals(tx as never, id, {
        from: "2026-10-01",
        to: "2026-10-31",
        accountIds: [id],
      }),
  };
}
it.each([
  [
    "missing cash account",
    (f: ReturnType<typeof actualsFixture>) => {
      f.rows.finance_accounts = [];
    },
    "account_unavailable",
  ],
  [
    "pending movement",
    (f: ReturnType<typeof actualsFixture>) => {
      f.movement.pending = true;
    },
    "pending",
  ],
  [
    "provider says expense",
    (f: ReturnType<typeof actualsFixture>) => {
      Object.assign(f.movement, { providerDirection: "expense" });
    },
    "not_income",
  ],
  [
    "unknown currency",
    (f: ReturnType<typeof actualsFixture>) => {
      Object.assign(f.movement, { currencyCode: null });
      Object.assign(f.account, { currencyCode: null });
    },
    "unsupported_currency",
  ],
  [
    "conflicting currency",
    (f: ReturnType<typeof actualsFixture>) => {
      f.movement.currencyCode = "EUR";
    },
    "unsupported_currency",
  ],
  [
    "transfer group",
    (f: ReturnType<typeof actualsFixture>) => {
      Object.assign(f.movement, { transferGroupId: "linked-transfer" });
    },
    "transfer_or_card_payment",
  ],
  [
    "matched transfer",
    (f: ReturnType<typeof actualsFixture>) => {
      f.movement.reconciliationStatus = "matched";
    },
    "transfer_or_card_payment",
  ],
  [
    "confirmed transfer",
    (f: ReturnType<typeof actualsFixture>) => {
      f.movement.reconciliationStatus = "confirmed";
    },
    "transfer_or_card_payment",
  ],
  [
    "unclassified category",
    (f: ReturnType<typeof actualsFixture>) => {
      f.movement.category = "OTHER";
    },
    "unclassified",
  ],
  [
    "reimbursed credit",
    (f: ReturnType<typeof actualsFixture>) => {
      f.rows.finance_reimbursement_matches = [
        { creditTransactionId: id, reimbursementId: "case", amount: 100 },
      ];
    },
    "reimbursement_or_refund_credit",
  ],
] as const)("does not treat %s as forecastable external income", async (_label, change, reason) => {
  const f = actualsFixture();
  change(f);
  const data = await f.read();
  expect(data.eligibility(f.movement as never, "income")).toMatchObject({
    eligible: false,
    reasons: expect.arrayContaining([reason]),
  });
});
it("rejects invalidated or incompletely allocated expenses while preserving the reviewed amounts", async () => {
  const f = actualsFixture();
  f.movement.direction = "expense";
  f.allocation.amount = 90;
  f.rows.finance_transaction_allocations = [f.allocation];
  const data = await f.read();
  expect(
    data.eligibility(f.movement as never, "expense", {
      ...f.allocation,
      state: "invalidated",
    } as never),
  ).toMatchObject({
    eligible: false,
    reasons: expect.arrayContaining(["allocation_invalidated", "unclassified"]),
  });
  expect(f.allocation.amount).toBe(90);
});
it("withholds linked movements whose relationship evidence has no valid economic event", async () => {
  const f = actualsFixture();
  f.rows.finance_transaction_relationships = [
    {
      id: "relationship",
      economicEventId: "missing",
      transactionIds: [id],
      relationship: "reimbursement",
      provenance: {},
      createdAt: new Date("2026-10-18T00:00:00Z"),
    },
  ];
  const data = await f.read();
  expect(data.eligibility(f.movement as never, "income")).toMatchObject({
    eligible: false,
    reasons: expect.arrayContaining(["unclassified", "reimbursement_or_refund_credit"]),
  });
});
it.each([
  "finance_recurring_schedule_versions",
  "finance_cash_balance_bases",
])("preserves immutable history when deletion would orphan %s", async (table) => {
  const f = actualsFixture();
  f.rows[table] = [{ id }];
  await expect(assertCashflowAccountMayBeDeleted(f.tx as never, id, id)).rejects.toMatchObject({
    code: "conflict",
  });
});

function projectionEvidenceFixture() {
  const f = actualsFixture();
  f.rows.finance_transactions = [];
  Object.assign(f.account, { contextualRevision: 1n });
  const basis = {
    id,
    accountId: id,
    basisRevision: 1,
    accountContextualRevision: 1n,
    kind: "current",
    amountCents: 1000,
    currencyCode: "USD",
    asOf: new Date("2026-10-18T10:00:00Z"),
    validUntil: new Date("2026-11-01T00:00:00Z"),
    protectedFloorCents: null,
    actorUserId: id,
    recordedAt: new Date("2026-10-18T10:00:00Z"),
  };
  f.rows.finance_cash_balance_bases = [basis];
  f.rows.finance_balance_inclusions = [];
  const payday = {
    key: "payday",
    source: { kind: "income", id },
    inCurrentSchedule: true,
    localDate: "2026-10-30",
    scheduleVersionId: id,
    amountBasis: "fixed",
    matchState: "unmatched",
    expectedAmountCents: 500,
    remainingExpectedCents: 500,
    matchIds: [],
    currencyCode: "USD",
    accountId: id,
  };
  const schedule = {
    from: "2026-10-01",
    to: "2026-10-31",
    occurrences: [payday],
    matchEvents: [],
    unavailableSources: [],
  };
  const findUser = vi.fn(async (): Promise<unknown> => ({ planningTimezone: "UTC" }));
  const tx = { ...f.tx, selectDistinctOn: f.tx.select, query: { users: { findFirst: findUser } } };
  const service = createFinanceBalanceBasisService({
    db: { transaction: async (work: (tx: unknown) => unknown) => work(tx) } as never,
    now: () => new Date("2026-10-18T12:00:00Z"),
    readOccurrences: vi.fn(async () => schedule as never),
  });
  return {
    ...f,
    basis,
    payday,
    schedule,
    findUser,
    project: () =>
      service.getFinanceCashflowProjection(id, {
        from: "2026-10-01",
        to: "2026-10-31",
        accountIds: [id],
        selectedIncomeStreamId: id,
      }),
  };
}
it("withholds a projection when the owner planning timezone is unavailable", async () => {
  const f = projectionEvidenceFixture();
  f.findUser.mockResolvedValue(undefined);
  await expect(f.project()).resolves.toMatchObject({
    projection: { status: "unavailable", reasons: [{ code: "balance_basis_unavailable" }] },
  });
});
it("does not select a historical or different income occurrence as the next payday", async () => {
  const f = projectionEvidenceFixture();
  f.payday.localDate = "2026-10-17";
  await expect(f.project()).resolves.toMatchObject({
    projection: { status: "unavailable", reasons: [{ code: "next_payday_unavailable" }] },
  });
});
it("withholds a forecast with an irregular schedule still active in its horizon", async () => {
  const f = projectionEvidenceFixture();
  f.rows.finance_recurring_schedule_versions = [
    { id, cadence: "irregular", effectiveFrom: "2026-10-01", supersedesId: null },
  ];
  await expect(f.project()).resolves.toMatchObject({
    projection: { status: "unavailable", reasons: [{ code: "unconfirmed_schedule" }] },
  });
});
it("does not reuse an invalidated amount for a future commitment", async () => {
  const f = projectionEvidenceFixture();
  f.payday.matchState = "invalidated";
  await expect(f.project()).resolves.toMatchObject({
    projection: { status: "unavailable", reasons: [{ code: "unknown_amount" }] },
  });
});
it("requires every known historical actual to have exact reflection evidence before calculating cash", async () => {
  const f = projectionEvidenceFixture();
  f.rows.finance_transactions = [
    { ...f.movement, contextualRevision: 2n, reimbursementRelationshipRevision: 3n },
  ];
  await expect(f.project()).resolves.toMatchObject({
    projection: { status: "unavailable", reasons: [{ code: "actual_review_required" }] },
  });
});
it("does not treat an explicitly unreflected pre-period actual as opening cash", async () => {
  const f = projectionEvidenceFixture();
  f.rows.finance_transactions = [
    {
      ...f.movement,
      transactionDate: "2026-09-30",
      contextualRevision: 2n,
      reimbursementRelationshipRevision: 3n,
    },
  ];
  f.rows.finance_balance_inclusions = [
    {
      basisId: id,
      transactionId: id,
      transactionContextualRevision: 2n,
      reimbursementRelationshipRevision: 3n,
      reflection: "not_included",
    },
  ];
  await expect(f.project()).resolves.toMatchObject({
    projection: { status: "unavailable", reasons: [{ code: "actual_review_required" }] },
  });
});
it("keeps a superseded historical irregular schedule outside the current forecast horizon", async () => {
  const f = projectionEvidenceFixture();
  f.rows.finance_recurring_schedule_versions = [
    { id: "old", cadence: "irregular", effectiveFrom: "2026-09-01", supersedesId: null },
    { id: "new", cadence: "monthly", effectiveFrom: "2026-10-01", supersedesId: "old" },
  ];
  await expect(f.project()).resolves.toMatchObject({
    projection: {
      status: "estimated",
      openingBalanceMinorUnits: 1000,
      endingBalanceMinorUnits: 1500,
    },
  });
});
it("preserves an unknown joint ownership share as unavailable rather than assuming sole ownership", async () => {
  const f = projectionEvidenceFixture();
  Object.assign(f.account, { ownershipType: "joint", ownershipShareBps: null });
  await expect(f.project()).resolves.toMatchObject({ projection: { status: "unavailable" } });
});
it("uses an explicitly confirmed whole joint share and zero protected floor without substituting unknown values", async () => {
  const f = projectionEvidenceFixture();
  Object.assign(f.account, { ownershipType: "joint", ownershipShareBps: 10000 });
  Object.assign(f.basis, { protectedFloorCents: 0 });
  const result = await f.project();
  expect(result.projection.status).toBe("estimated");
  expect(result.projection).toMatchObject({
    openingBalanceMinorUnits: 1000,
    endingBalanceMinorUnits: 1500,
  });
});
