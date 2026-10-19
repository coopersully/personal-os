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

const blockedCreditCases: Array<[string, (input: IncludedCreditInput) => IncludedCreditInput]> = [
  [
    "not included",
    (input) => ({ ...input, reflection: { ...input.reflection!, reflection: "not_included" } }),
  ],
  ["missing reflection", (input) => ({ ...input, reflection: undefined })],
  [
    "stale contextual revision",
    (input) => ({ ...input, reflection: { ...input.reflection!, transactionRevision: "1" } }),
  ],
  [
    "missing contextual revision",
    (input) => ({ ...input, reflection: { ...input.reflection!, transactionRevision: "" } }),
  ],
  [
    "stale relationship generation",
    (input) => ({
      ...input,
      reflection: { ...input.reflection!, reimbursementRelationshipRevision: "2" },
    }),
  ],
  [
    "missing relationship generation",
    (input) => ({
      ...input,
      reflection: { ...input.reflection!, reimbursementRelationshipRevision: null },
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
