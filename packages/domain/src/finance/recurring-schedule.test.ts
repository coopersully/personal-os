import { expect, it } from "vitest";
import { confirmFinanceBalanceBasisInputSchema } from "./balance-basis.js";
import { manageFinanceOccurrenceMatchInputSchema } from "./occurrence-match.js";
import {
  confirmFinanceRecurringScheduleInputSchema,
  financeRecurringOccurrencesQuerySchema,
} from "./recurring-schedule.js";

const id = "f2000000-0000-4000-8000-000000000001";
const schedule = {
  source: { kind: "income", id },
  accountId: id,
  cadence: "semimonthly",
  timezone: "America/New_York",
  anchorLocalDate: "2026-01-31",
  effectiveFrom: "2026-03-01",
  semimonthlyDays: [15, 31],
  amountBasis: "fixed",
  amountCents: 12345,
  currencyCode: "EUR",
  expectedSourceRevision: 2,
  supersedesId: null,
  idempotencyKey: "schedule",
};
it("requires explicit original schedule inputs, fixed amount and two distinct semimonthly slots", () => {
  expect(confirmFinanceRecurringScheduleInputSchema.safeParse(schedule).success).toBe(true);
  for (const change of [
    { anchorLocalDate: undefined },
    { amountCents: null },
    { semimonthlyDays: [31, 31] },
    { timezone: "Unknown/Zone" },
    { expectedSourceRevision: undefined },
    { currencyCode: "XAU" },
  ])
    expect(
      confirmFinanceRecurringScheduleInputSchema.safeParse({ ...schedule, ...change }).success,
    ).toBe(false);
  expect(
    confirmFinanceRecurringScheduleInputSchema.safeParse({
      ...schedule,
      amountBasis: "variable",
      amountCents: null,
    }).success,
  ).toBe(true);
});
it("bounds range queries to366 inclusive dates without accepting a range as an anchor", () => {
  expect(
    financeRecurringOccurrencesQuerySchema.safeParse({ from: "2026-01-31", to: "2027-01-31" })
      .success,
  ).toBe(true);
  expect(
    financeRecurringOccurrencesQuerySchema.safeParse({ from: "2026-01-31", to: "2027-02-01" })
      .success,
  ).toBe(false);
  expect(
    financeRecurringOccurrencesQuerySchema.safeParse({ from: "2026-02-01", to: "2026-01-31" })
      .success,
  ).toBe(false);
});
it("requires actual revision evidence and never manufactures an income allocation", () => {
  const input = {
    operation: "match_income",
    occurrence: { scheduleVersionId: id, localDate: "2026-03-31", slot: 0 },
    transactionId: id,
    expectedTransactionRevision: "3",
    expectedReimbursementRelationshipRevision: "2",
    amountCents: 12345,
    currencyCode: "EUR",
    rationale: "Explicit actual income",
    idempotencyKey: "match",
  };
  expect(manageFinanceOccurrenceMatchInputSchema.safeParse(input).success).toBe(true);
  expect(
    manageFinanceOccurrenceMatchInputSchema.safeParse({ ...input, allocationId: id }).success,
  ).toBe(false);
  expect(
    manageFinanceOccurrenceMatchInputSchema.safeParse({
      ...input,
      expectedTransactionRevision: "invalid",
    }).success,
  ).toBe(false);
  expect(
    manageFinanceOccurrenceMatchInputSchema.safeParse({ ...input, operation: "match_expense" })
      .success,
  ).toBe(false);
  expect(
    manageFinanceOccurrenceMatchInputSchema.safeParse({
      operation: "reverse",
      matchId: id,
      rationale: "Reverse original actual",
      idempotencyKey: "reverse",
      amountCents: 1,
    }).success,
  ).toBe(false);
});
it("requires a bounded explicit balance statement with unique exact transaction reflections", () => {
  const input = {
    accountId: id,
    expectedAccountRevision: "2",
    expectedBasisRevision: 0,
    kind: "available",
    amountCents: 10000,
    currencyCode: "EUR",
    asOf: "2026-03-01T00:00:00Z",
    validUntil: "2026-03-02T00:00:00Z",
    protectedFloorCents: null,
    reflections: [{ transactionId: id, transactionRevision: "3", reimbursementRelationshipRevision: "2", reflection: "included" }],
    idempotencyKey: "basis",
  };
  expect(confirmFinanceBalanceBasisInputSchema.safeParse(input).success).toBe(true);
  expect(
    confirmFinanceBalanceBasisInputSchema.safeParse({
      ...input,
      reflections: [...input.reflections, ...input.reflections],
    }).success,
  ).toBe(false);
  expect(
    confirmFinanceBalanceBasisInputSchema.safeParse({
      ...input,
      validUntil: "2026-02-28T00:00:00Z",
    }).success,
  ).toBe(false);
  expect(
    confirmFinanceBalanceBasisInputSchema.safeParse({ ...input, kind: "synced" }).success,
  ).toBe(false);
});

it("requires independent relationship revisions and never treats a legacy missing generation as confirmation", () => {
  const input = { operation: "match_income", occurrence: { scheduleVersionId: id, localDate: "2026-03-31", slot: 0 }, transactionId: id, expectedTransactionRevision: "3", amountCents: 100, currencyCode: "USD", rationale: "Explicit actual", idempotencyKey: "relation" };
  expect(manageFinanceOccurrenceMatchInputSchema.safeParse(input).success).toBe(false);
  expect(manageFinanceOccurrenceMatchInputSchema.safeParse({ ...input, expectedReimbursementRelationshipRevision: "1" }).success).toBe(true);
  expect(manageFinanceOccurrenceMatchInputSchema.safeParse({ ...input, expectedReimbursementRelationshipRevision: "0" }).success).toBe(false);
});
