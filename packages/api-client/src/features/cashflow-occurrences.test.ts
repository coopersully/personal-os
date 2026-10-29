import { expect, it, vi } from "vitest";
import { createFinanceApi } from "./finances.js";

it("preserves explicit empty account scope versus all in real cashflow read methods", async () => {
  const request = vi.fn().mockResolvedValue({});
  const api = createFinanceApi(request);
  await api.listFinanceCashflowSources({ from: "2026-03-01", to: "2026-03-31", accountIds: [] });
  expect(request.mock.calls[0]?.[0]).toContain("accountIds=");
  await api.listFinanceRecurringOccurrences({ from: "2026-03-01", to: "2026-03-31" });
  expect(request.mock.calls[1]?.[0]).not.toContain("accountIds");
  await api.getFinanceCashflowProjection({
    from: "2026-03-01",
    to: "2026-03-31",
    selectedIncomeStreamId: null,
  });
  expect(request.mock.calls[2]?.[0]).not.toContain("selectedIncomeStreamId");
});
it("sends explicit match statements through the canonical transport without changing their evidence", async () => {
  const request = vi.fn().mockResolvedValue({});
  const api = createFinanceApi(request);
  const input = {
    operation: "reverse" as const,
    matchId: "f2000000-0000-4000-8000-000000000001",
    rationale: "Reverse exact original",
    idempotencyKey: "reverse",
  };
  await api.manageFinanceOccurrenceMatch(input);
  expect(request).toHaveBeenCalledWith("/v1/finances/recurring-occurrence-matches", {
    method: "POST",
    body: JSON.stringify(input),
  });
});

it("reviews complete balance history independently of the calendar range and preserves account scope", async () => {
  const request = vi.fn().mockResolvedValue({});
  const api = createFinanceApi(request);
  await api.listFinanceBalanceBasisSources({ accountIds: [] });
  expect(request).toHaveBeenLastCalledWith("/v1/finances/balance-basis-sources?accountIds=");
  await api.listFinanceBalanceBasisSources();
  expect(request).toHaveBeenLastCalledWith("/v1/finances/balance-basis-sources?");
});
