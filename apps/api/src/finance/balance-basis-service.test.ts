import type { Database } from "@personal-os/database";
import { financeRecurringOccurrencesQuerySchema } from "@personal-os/domain";
import { expect, it, vi } from "vitest";
import { createFinanceBalanceBasisService } from "./balance-basis-service.js";
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
