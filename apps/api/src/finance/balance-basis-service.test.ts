import type { Database } from "@personal-os/database";
import { financeRecurringOccurrencesQuerySchema, projectPaydayCycle } from "@personal-os/domain";
import { expect, it, vi } from "vitest";
import {
  createFinanceBalanceBasisService,
  isIncludedNonRecurringCredit,
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
