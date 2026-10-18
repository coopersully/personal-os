import type { Database } from "@personal-os/database";
import { expect, it } from "vitest";
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
