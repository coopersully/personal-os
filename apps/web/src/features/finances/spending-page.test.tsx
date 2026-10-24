// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  type FinanceSpendingDashboard,
  type FinanceSpendingQuery,
  type FinanceSpendingReferenceFilter,
  resolveWorkspaceSettings,
} from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "@/api";
import { FinanceSpendingPage } from "./spending-page";
import { spendingRecoveryDestination } from "./spending-reference";

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

const accountId = "00000000-0000-4000-8000-000000000123";
function dashboard(query: FinanceSpendingQuery): FinanceSpendingDashboard {
  const contribution = {
    id: "contribution-one",
    transactionId: "transaction-one",
    allocationId: null,
    categoryId: "food",
    accountId,
    date: query.scope.from,
    pending: true,
    currencyCode: "USD" as const,
    grossCents: 1200,
    reimbursementAdjustmentCents: 200,
    reimbursementOutstandingCents: 200,
    reimbursementIds: ["reimbursement-one"],
    refundAdjustmentCents: 100,
    netCents: 900,
  };
  const drillDown = {
    scope: query.scope,
    contributionIds: [contribution.id],
    transactionIds: [contribution.transactionId],
  };
  const group = {
    id: "food",
    label: "Groceries",
    kind: "category" as const,
    categoryIds: ["food"],
    netCents: 900,
    positiveAreaCents: 900,
    grossCents: 1200,
    reimbursementAdjustmentCents: 200,
    reimbursementOutstandingCents: 200,
    refundAdjustmentCents: 100,
    pendingCents: 900,
    drillDown,
    categories: [],
  };
  return {
    schemaVersion: 1,
    snapshot: {
      schemaVersion: 1,
      scope: query.scope,
      asOf: "2026-10-18T12:00:00Z",
      coverage: "partial",
      contributions: [contribution],
      bins: [
        {
          date: query.scope.from,
          netCents: 900,
          positiveAreaCents: 900,
          negativeAdjustmentCents: 0,
          pendingCents: 900,
          coverage: "unknown",
          provisional: true,
          future: false,
          drillDown,
        },
      ],
      netCents: 900,
      positiveAreaCents: 900,
      negativeAdjustmentCents: 0,
      qualifications: [{ code: "ownership_unknown", sourceIds: ["private-source-id"] }],
      budgetComparison: { status: "unavailable", reason: "historical_budget_not_resolved" },
    },
    effectiveGrouping: "categories",
    groupingFallback: null,
    groups: [group],
    positiveAreaCents: 900,
    negativeAdjustmentCents: 0,
    excludedUncategorizedCents: 0,
    accounts: [{ id: accountId, label: "Everyday account" }],
    categories: [{ id: "food", label: "Groceries" }],
    transactions: [
      {
        id: "transaction-one",
        accountId,
        merchant: "Market",
        date: query.scope.from,
        pending: true,
      },
    ],
    source: {
      freshness: "current",
      lastSyncedAt: "2026-10-18T12:00:00Z",
      reasons: ["historical_coverage_not_certified"],
    },
    currency: { supported: "USD", unsupported: [] },
  };
}
const saved = resolveWorkspaceSettings("finances", {
  financeSpendingView: "list",
  financeSpendingGrouping: "categories",
  spendAccountIds: null,
  revision: 3,
});
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(api, "getMe").mockResolvedValue({
    id: "owner",
    planningTimezone: "America/New_York",
  } as Awaited<ReturnType<typeof api.getMe>>);
  vi.spyOn(api, "getWorkspaceSettings").mockImplementation(async (workspace) =>
    workspace === "calendar"
      ? resolveWorkspaceSettings("calendar", { weekStartsOn: "monday" })
      : (saved as never),
  );
  vi.spyOn(api, "updateWorkspaceSettings").mockImplementation(
    async (_workspace, input) =>
      resolveWorkspaceSettings("finances", {
        ...saved.preferences,
        ...input.preferences,
        revision: 4,
      }) as never,
  );
  vi.spyOn(api, "getFinanceSpending").mockImplementation(async (query) => dashboard(query));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function mount(search = "") {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  cache.setQueryData(["me"], { id: "owner", planningTimezone: "America/New_York" });
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={[`/finances/spending${search}`]}>
        <FinanceSpendingPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return cache;
}
it("restores saved defaults and honors explicit URL overrides without autosaving", async () => {
  mount(
    "?view=bubbles&grouping=auto&pending=0&accounts=&categories=food,uncategorized&period=week&from=2026-03-08",
  );
  await waitFor(() => expect(api.getFinanceSpending).toHaveBeenCalled());
  expect(api.getFinanceSpending).toHaveBeenLastCalledWith(
    expect.objectContaining({
      grouping: "auto",
      scope: expect.objectContaining({
        accountIds: [],
        categoryIds: ["food", null],
        timezone: "America/New_York",
        includePending: false,
        from: "2026-03-02",
        through: "2026-03-08",
      }),
    }),
  );
  expect(screen.getByRole("button", { name: "View: Bubbles" })).toBeVisible();
  expect(api.updateWorkspaceSettings).not.toHaveBeenCalled();
});
it("restores saved List and persists only explicit account and view changes", async () => {
  mount();
  await screen.findByRole("button", { name: "Groceries" });
  expect(screen.getByRole("button", { name: "View: List" })).toBeVisible();
  expect(api.getFinanceSpending).toHaveBeenLastCalledWith(
    expect.objectContaining({ scope: expect.objectContaining({ accountIds: null }) }),
  );
  fireEvent.click(screen.getByText("Spending options"));
  fireEvent.click(screen.getByRole("button", { name: "Select none" }));
  await waitFor(() =>
    expect(api.updateWorkspaceSettings).toHaveBeenCalledWith(
      "finances",
      expect.objectContaining({ expectedRevision: 3, preferences: { spendAccountIds: [] } }),
    ),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Use all eligible accounts" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Use all eligible accounts" }));
  await waitFor(() =>
    expect(api.updateWorkspaceSettings).toHaveBeenLastCalledWith(
      "finances",
      expect.objectContaining({ preferences: { spendAccountIds: null } }),
    ),
  );
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await waitFor(() => expect(screen.getByRole("button", { name: "View: List" })).toBeEnabled());
  fireEvent.keyDown(screen.getByRole("button", { name: "View: List" }), { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("menuitemradio", { name: "Bubbles" }));
  await waitFor(() =>
    expect(api.updateWorkspaceSettings).toHaveBeenLastCalledWith(
      "finances",
      expect.objectContaining({ preferences: { financeSpendingView: "bubbles" } }),
    ),
  );
});
it("opens exact contribution detail and explains qualifications without exposing IDs by default", async () => {
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Groceries" }));
  const dialog = await screen.findByRole("dialog");
  expect(dialog).toHaveTextContent("Market");
  expect(dialog).toHaveTextContent("$12.00");
  expect(dialog).toHaveTextContent("$9.00");
  expect(dialog).toHaveTextContent("$2.00");
  expect(screen.queryByText("ownership_unknown")).not.toBeInTheDocument();
  fireEvent.keyDown(dialog, { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Spending breakdown" }));
  fireEvent.click(screen.getByText("Coverage and accounting details"));
  expect(screen.getByText(/Some account ownership is unknown/)).toBeVisible();
  expect(screen.getByText("ownership_unknown · private-source-id")).not.toBeVisible();
});
it("rejects invalid URL dates and recovers without saving filters", async () => {
  mount("?period=custom&from=2026-02-30&through=2026-03-01");
  await screen.findByRole("button", { name: "Reset spending filters" });
  expect(api.getFinanceSpending).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Reset spending filters" }));
  await screen.findByRole("button", { name: "Groceries" });
  expect(api.updateWorkspaceSettings).not.toHaveBeenCalled();
});
it("keeps loading unknown and retries failed spending reads", async () => {
  let reject!: (error: Error) => void;
  vi.mocked(api.getFinanceSpending).mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  mount();
  await waitFor(() => expect(api.getFinanceSpending).toHaveBeenCalled());
  expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
  reject(new Error("Unavailable"));
  await screen.findByText("Couldn’t load spending.");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByRole("button", { name: "Groceries" });
});
it("queries comparable elapsed Trends periods with identical accounting filters and opens a bin", async () => {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  mount(
    `?view=trends&period=month&from=${year}-${month}-01&pending=0&basis=full_outflow&refunds=0&accounts=&categories=food`,
  );
  await screen.findByRole("region", { name: "Spending trends" });
  await waitFor(() => expect(api.getFinanceSpending).toHaveBeenCalledTimes(3));
  const calls = vi.mocked(api.getFinanceSpending).mock.calls.map(([query]) => query);
  const queries = calls.filter((query) => query.scope.categoryIds !== null);
  expect(calls.filter((query) => query.scope.categoryIds === null)).toHaveLength(1);
  expect(
    queries.every(
      (query) =>
        query.scope.includePending === false &&
        query.scope.basis === "full_outflow" &&
        query.scope.subtractRefunds === false &&
        query.scope.accountIds?.length === 0 &&
        query.scope.categoryIds?.[0] === "food",
    ),
  ).toBe(true);
  expect(queries[0]?.scope.through).toBe(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now),
  );
  expect(queries[1]?.scope.from).not.toBe(queries[0]?.scope.from);
  fireEvent.click(screen.getByRole("button", { name: /\$9.00; Missing coverage/ }));
  expect(await screen.findByRole("dialog")).toHaveTextContent("Market");
  expect(api.updateWorkspaceSettings).not.toHaveBeenCalled();
});
it("defaults Rhythm to three calendar months using saved Monday week start and respects explicit ranges", async () => {
  mount("?view=rhythm");
  await screen.findByRole("region", { name: "Spending rhythm" });
  expect(screen.getByRole("group", { name: "Spending range" })).toHaveTextContent(
    "last three months",
  );
  const query = vi.mocked(api.getFinanceSpending).mock.calls[0]?.[0];
  if (!query) throw new Error("No Rhythm query");
  const start = new Date(`${query.scope.from}T12:00:00Z`),
    end = new Date(`${query.scope.through}T12:00:00Z`);
  expect(
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth(),
  ).toBe(2);
  expect(
    screen.getByRole("button", { name: "Rhythm interval: Auto · weekly" }),
  ).toBeInTheDocument();
  expect(api.updateWorkspaceSettings).not.toHaveBeenCalled();
  cleanup();
  vi.mocked(api.getFinanceSpending).mockClear();
  mount("?view=rhythm&period=custom&from=2026-03-01&through=2026-03-08");
  await screen.findByRole("region", { name: "Spending rhythm" });
  expect(api.getFinanceSpending).toHaveBeenLastCalledWith(
    expect.objectContaining({
      scope: expect.objectContaining({ from: "2026-03-01", through: "2026-03-08" }),
    }),
  );
});
it("offers scope confirmation only for an unavailable single-month comparison", async () => {
  vi.mocked(api.getFinanceSpending).mockImplementation(async (query) => ({
    ...dashboard(query),
    monthlyBudget: {
      state: "unavailable",
      reason: "qualification_required",
      qualificationRequired: true,
    },
  }));
  mount("?period=custom&from=2026-09-01&through=2026-09-30");
  fireEvent.click(await screen.findByRole("button", { name: "Spending breakdown" }));
  fireEvent.click(screen.getByText("Coverage and accounting details"));
  await screen.findByText("Confirm this month's budget scope");
  cleanup();
  mount("?period=custom&from=2026-08-01&through=2026-09-30");
  await screen.findByRole("button", { name: "Groceries" });
  expect(screen.queryByText("Confirm this month's budget scope")).not.toBeInTheDocument();
});
it("uses qualified whole-month usage alongside selected-day amounts without changing the legacy snapshot contract", async () => {
  vi.mocked(api.getFinanceSpending).mockImplementation(async (query) => ({
    ...dashboard(query),
    monthlyBudget: {
      state: "qualified",
      month: "2026-09",
      period: { from: "2026-09-01", through: "2026-09-30", timezone: "America/Chicago" },
      currency: "USD",
      accountIds: [accountId],
      qualificationId: "qualified",
      confirmedAt: "2026-10-18T12:00:00Z",
      qualificationKind: "retrospective",
      coverage: "unknown",
      includesPending: true,
      basis: "personal_cost",
      subtractsRefunds: true,
      groups: [
        { groupId: "food", budgetCents: 10000, usedCents: 2500, overspent: false },
        { groupId: "child-category", budgetCents: 10000, usedCents: 2500, overspent: false },
      ],
    },
  }));
  mount("?view=list&period=today&from=2026-09-08");
  await screen.findByTitle("Observed monthly $25.00 of $100.00 · 25.0%");
  expect(screen.getByText("$100.00 · 25%")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Spending breakdown" }));
  fireEvent.click(screen.getByText("Coverage and accounting details"));
  expect(screen.getByText(/America\/Chicago/)).toBeVisible();
  expect(screen.getByText(/Confirmed later/)).toBeVisible();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.queryByText("Confirm this month's budget scope")).not.toBeInTheDocument();
  if (screen.queryByRole("dialog", { name: "Spending breakdown" }))
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Groceries" }));
  const detail = await screen.findByRole("dialog");
  expect(detail).toHaveTextContent("Monthly usage: $25.00 of $100.00");
  expect(detail).toHaveTextContent("whole qualified month");
  expect(detail).toHaveTextContent("Observed usage · historical coverage unknown");
});

function recoveryFilter(groupId: string | null = "food"): FinanceSpendingReferenceFilter {
  return {
    query: {
      scope: {
        from: "2026-09-01",
        through: "2026-09-30",
        timezone: "America/Chicago",
        accountIds: [],
        categoryIds: ["food", null],
        basis: "full_outflow",
        includePending: false,
        subtractRefunds: false,
      },
      grouping: "buckets",
      includeUncategorized: false,
    },
    referenceRevision: "a".repeat(64),
    groupId,
    from: "2026-09-08",
    through: "2026-09-09",
  };
}
function recoverySearch(filter: FinanceSpendingReferenceFilter) {
  const destination = spendingRecoveryDestination(filter);
  if (!destination) throw new Error("Invalid recovery fixture");
  return destination.slice(destination.indexOf("?"));
}
it("recovers the original full query and changed timezone, then opens a freshly recomputed exact group subset without autosave", async () => {
  const filter = recoveryFilter();
  vi.mocked(api.getFinanceSpending).mockImplementation(async (query) => {
    const value = dashboard(query);
    for (const item of value.snapshot.contributions) item.date = "2026-09-08";
    value.referenceRevision = "b".repeat(64);
    return value;
  });
  mount(recoverySearch(filter));
  const dialog = await screen.findByRole("dialog");
  expect(api.getFinanceSpending).toHaveBeenCalledTimes(1);
  expect(api.getFinanceSpending).toHaveBeenLastCalledWith(filter.query);
  expect(dialog).toHaveTextContent("Groceries");
  expect(dialog).toHaveTextContent("2026-09-08 – 2026-09-09");
  expect(dialog).toHaveTextContent("Market");
  expect(dialog).toHaveTextContent("$9.00");
  expect(api.getFinanceSpending).toHaveBeenLastCalledWith(
    expect.objectContaining({ scope: expect.objectContaining({ timezone: "America/Chicago" }) }),
  );
  expect(screen.getByText(/Recovered selection · current Spending data/)).toBeInTheDocument();
  expect(api.updateWorkspaceSettings).not.toHaveBeenCalled();
  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  const controls = new URLSearchParams(screen.getByTestId("location").textContent ?? "");
  expect(controls.has("recoverSpending")).toBe(false);
  expect(controls.get("timezone")).toBe("America/Chicago");
  expect(controls.get("accounts")).toBe("");
  expect(controls.get("categories")).toBe("food,uncategorized");
  expect(controls.get("from")).toBe("2026-09-01");
  expect(controls.get("through")).toBe("2026-09-30");
  expect(api.updateWorkspaceSettings).not.toHaveBeenCalled();
});
it("recovers a date-bin subset with null group and all accounts without using old membership lists", async () => {
  const filter = recoveryFilter(null);
  filter.query.scope.accountIds = null;
  vi.mocked(api.getFinanceSpending).mockImplementation(async (query) => {
    const value = dashboard(query);
    const first = value.snapshot.contributions[0];
    if (first) first.date = "2026-09-08";
    return value;
  });
  mount(recoverySearch(filter));
  const dialog = await screen.findByRole("dialog");
  expect(dialog).toHaveTextContent("Spending detail");
  expect(dialog).toHaveTextContent("Market");
  expect(dialog).toHaveTextContent("2026-09-08 – 2026-09-09");
  expect(api.getFinanceSpending).toHaveBeenLastCalledWith(filter.query);
  expect(api.updateWorkspaceSettings).not.toHaveBeenCalled();
});
it("fails closed for invalid and oversized recovery JSON and allows an explicit reset", async () => {
  for (const raw of ["{", "x".repeat(16001)]) {
    mount(`?recoverSpending=${encodeURIComponent(raw)}`);
    await screen.findByText(/recovered Spending reference is invalid or too large/);
    expect(api.getFinanceSpending).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    cleanup();
  }
  mount("?recoverSpending=%7B");
  fireEvent.click(await screen.findByRole("button", { name: "Reset spending filters" }));
  await screen.findByRole("button", { name: "Groceries" });
  expect(api.updateWorkspaceSettings).not.toHaveBeenCalled();
});
it("never replaces a missing recovered group with a broader selection", async () => {
  mount(recoverySearch(recoveryFilter("deleted-group")));
  await screen.findByText(/recovered group is no longer available/);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(api.updateWorkspaceSettings).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole("button", { name: /^Group by:/ }), { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("menuitemradio", { name: "Categories" }));
  await waitFor(() =>
    expect(screen.getByTestId("location")).not.toHaveTextContent("recoverSpending"),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("explains empty selected data and unsupported source money without showing unrelated transactions", async () => {
  vi.mocked(api.getFinanceSpending).mockImplementation(async (query) => {
    const value = dashboard(query);
    value.groups = [];
    value.snapshot.contributions = [];
    value.snapshot.netCents = 0;
    value.transactions = [];
    value.groupingFallback = "buckets_unavailable" as FinanceSpendingDashboard["groupingFallback"];
    value.excludedUncategorizedCents = 125;
    value.negativeAdjustmentCents = 75;
    value.source.lastSyncedAt = null;
    value.source.reasons = ["new_provider_qualification"];
    value.snapshot.qualifications = [];
    value.currency.unsupported = [
      { code: "EUR", transactionIds: ["foreign"] },
      { code: null, transactionIds: ["unknown"] },
    ];
    return value;
  });
  mount("?accounts=&categories=&pending=0");
  await screen.findByText("No spending in this selection");
  fireEvent.click(screen.getByRole("button", { name: "Spending breakdown" }));
  fireEvent.click(screen.getByText("Coverage and accounting details"));
  expect(screen.getByText(/Buckets unavailable; showing categories/)).toBeVisible();
  expect(screen.getByText("Excluded uncategorized: $1.25")).toBeVisible();
  expect(screen.getByText("Negative adjustments: $0.75")).toBeVisible();
  expect(screen.getByText(/Last sync unknown/)).toBeVisible();
  expect(
    screen.getByText(/EUR \(1 transactions\).*Unspecified currency \(1 transactions\)/),
  ).toBeVisible();
  expect(screen.queryByText("Market")).not.toBeInTheDocument();
  expect(screen.getByText(/Some spending evidence needs review/)).toBeVisible();
  expect(api.getFinanceSpending).toHaveBeenLastCalledWith(
    expect.objectContaining({
      scope: expect.objectContaining({ accountIds: [], categoryIds: [], includePending: false }),
    }),
  );
});
it("rejects an invalid timezone before reading money and resets to the owner's timezone", async () => {
  mount("?timezone=Not/AZone");
  fireEvent.click(await screen.findByRole("button", { name: "Reset spending filters" }));
  await screen.findByRole("button", { name: "Groceries" });
  expect(
    vi
      .mocked(api.getFinanceSpending)
      .mock.calls.every(([query]) => query.scope.timezone === "America/New_York"),
  ).toBe(true);
  expect(api.updateWorkspaceSettings).not.toHaveBeenCalled();
});
it("changes account membership and accounting options with explicit revisioned preference saves", async () => {
  mount("?accounts=all");
  await screen.findByRole("button", { name: "Groceries" });
  fireEvent.click(screen.getByText("Spending options"));
  fireEvent.click(screen.getByRole("checkbox", { name: "Everyday account" }));
  await waitFor(() =>
    expect(api.updateWorkspaceSettings).toHaveBeenLastCalledWith(
      "finances",
      expect.objectContaining({ preferences: { spendAccountIds: [] } }),
    ),
  );
  await waitFor(() =>
    expect(screen.getByRole("checkbox", { name: "Everyday account" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "Everyday account" }));
  await waitFor(() =>
    expect(api.updateWorkspaceSettings).toHaveBeenLastCalledWith(
      "finances",
      expect.objectContaining({ preferences: { spendAccountIds: [accountId] } }),
    ),
  );
  fireEvent.keyDown(screen.getByRole("button", { name: /^Basis:/ }), { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("menuitemradio", { name: "Full outflow" }));
  await waitFor(() =>
    expect(api.updateWorkspaceSettings).toHaveBeenLastCalledWith(
      "finances",
      expect.objectContaining({ preferences: { financeSpendingBasis: "full_outflow" } }),
    ),
  );
  await waitFor(() =>
    expect(screen.getByRole("checkbox", { name: "Include pending" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "Include pending" }));
  await waitFor(() =>
    expect(api.updateWorkspaceSettings).toHaveBeenLastCalledWith(
      "finances",
      expect.objectContaining({ preferences: { financeSpendingIncludePending: false } }),
    ),
  );
});
it("focuses Trends on a group then restores all categories without saving a category preference", async () => {
  mount("?view=trends&period=custom&from=2026-09-01&through=2026-09-30");
  await screen.findByRole("region", { name: "Spending trends" });
  fireEvent.keyDown(await screen.findByRole("button", { name: /^Focus:/ }), { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("menuitemradio", { name: "Groceries" }));
  await waitFor(() =>
    expect(api.getFinanceSpending).toHaveBeenCalledWith(
      expect.objectContaining({ scope: expect.objectContaining({ categoryIds: ["food"] }) }),
    ),
  );
  fireEvent.keyDown(await screen.findByRole("button", { name: /^Focus:/ }), { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("menuitemradio", { name: "All categories" }));
  await waitFor(() => expect(screen.getByTestId("location")).not.toHaveTextContent("categories="));
  expect(api.updateWorkspaceSettings).not.toHaveBeenCalled();
});
it("clears missing recovery explicitly while retaining its full accounting filters", async () => {
  mount(recoverySearch(recoveryFilter("deleted-group")));
  fireEvent.click(await screen.findByRole("button", { name: "Clear recovered selection" }));
  await waitFor(() =>
    expect(screen.getByTestId("location")).not.toHaveTextContent("recoverSpending"),
  );
  expect(screen.getByTestId("location")).toHaveTextContent("refunds=0");
  expect(screen.getByTestId("location")).toHaveTextContent("accounts=");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(api.updateWorkspaceSettings).not.toHaveBeenCalled();
});
it("saves explicit grouping and period choices, navigates periods, and retains edited custom dates", async () => {
  mount("?period=month&from=2026-09-01");
  await screen.findByRole("button", { name: "Groceries" });
  fireEvent.keyDown(screen.getByRole("button", { name: /^Group by:/ }), { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("menuitemradio", { name: "Buckets" }));
  await waitFor(() =>
    expect(api.updateWorkspaceSettings).toHaveBeenLastCalledWith(
      "finances",
      expect.objectContaining({ preferences: { financeSpendingGrouping: "buckets" } }),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: /^Date range:/ }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Previous period" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Previous period" }));
  await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("from=2026-08-01"));
  fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
  await waitFor(() =>
    expect(api.updateWorkspaceSettings).toHaveBeenLastCalledWith(
      "finances",
      expect.objectContaining({ preferences: { financeSpendingPeriod: "custom" } }),
    ),
  );
  await waitFor(() => expect(screen.getByLabelText("From")).toBeEnabled());
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-07-01" } });
  await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("from=2026-07-01"));
  expect(api.updateWorkspaceSettings).toHaveBeenLastCalledWith(
    "finances",
    expect.objectContaining({ preferences: { financeSpendingPeriod: "custom" } }),
  );
});

it("opens the selected spending chart, breakdown, and qualifications from the total", async () => {
  mount("?view=bubbles&period=custom&from=2020-01-01&through=2020-01-03&pending=1");
  await screen.findByText("Daily average");
  expect(screen.getByText("$3.00")).toBeVisible();
  expect(screen.getByText("3 days elapsed")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Inspect largest spending group: Groceries" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Spending breakdown" }));
  expect(await screen.findByRole("dialog")).toHaveTextContent("Includes pending transactions");
  expect(screen.getByRole("dialog")).toHaveTextContent("Partial or unverified coverage");
  expect(screen.getByText("Daily spending")).toBeVisible();
  expect(screen.getByRole("heading", { name: "Breakdown" })).toBeVisible();
});

it("does not invent an average for an entirely future range", async () => {
  mount("?view=bubbles&period=custom&from=2099-01-01&through=2099-01-03&pending=0");
  expect(await screen.findByText("No elapsed days")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Spending breakdown" }));
  expect(await screen.findByRole("dialog")).toHaveTextContent("Posted transactions only");
});

it("retains the mounted summary during a same-owner range refresh and marks it busy", async () => {
  mount("?period=month&from=2026-09-01");
  const total = await screen.findByRole("button", { name: "Spending breakdown" });
  let complete: ((value: FinanceSpendingDashboard) => void) | undefined;
  vi.mocked(api.getFinanceSpending).mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: /^Date range:/ }));
  fireEvent.click(screen.getByRole("button", { name: "Previous period" }));
  await waitFor(() => expect(total.closest("[aria-busy]")).toHaveAttribute("aria-busy", "true"));
  expect(screen.getByRole("button", { name: "Spending breakdown" })).toBe(total);
  await waitFor(() => expect(complete).toBeDefined());
  const query = vi.mocked(api.getFinanceSpending).mock.calls.at(-1)?.[0];
  if (!query || !complete) throw new Error("Missing range refresh");
  complete(dashboard(query));
  await waitFor(() => expect(total.closest("[aria-busy]")).toHaveAttribute("aria-busy", "false"));
  expect(screen.getByRole("button", { name: "Spending breakdown" })).toBe(total);
});

it("retains every bucket in the focus picker after narrowing and labels the all option correctly", async () => {
  vi.mocked(api.getFinanceSpending).mockImplementation(async (query) => {
    const value = dashboard(query);
    value.effectiveGrouping = "buckets";
    const base = value.groups[0];
    if (!base) throw new Error("Missing fixture group");
    const all = [
      {
        ...base,
        id: "essentials",
        label: "Essentials",
        kind: "bucket" as const,
        categoryIds: ["food", "housing"],
      },
      {
        ...base,
        id: "lifestyle",
        label: "Lifestyle",
        kind: "bucket" as const,
        categoryIds: ["dining"],
      },
    ];
    value.groups =
      query.scope.categoryIds === null
        ? all
        : all.filter((group) =>
            group.categoryIds.some((id) => query.scope.categoryIds?.includes(id)),
          );
    return value;
  });
  mount("?view=trends&grouping=buckets&period=month");
  fireEvent.keyDown(await screen.findByRole("button", { name: "Focus: All buckets" }), {
    key: "ArrowDown",
  });
  fireEvent.click(await screen.findByRole("menuitemradio", { name: "Essentials" }));
  await screen.findByRole("button", { name: "Focus: Essentials" });
  fireEvent.keyDown(screen.getByRole("button", { name: "Focus: Essentials" }), {
    key: "ArrowDown",
  });
  expect(await screen.findByRole("menuitemradio", { name: "Lifestyle" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("menuitemradio", { name: "All buckets" }));
  await waitFor(() => expect(screen.getByTestId("location")).not.toHaveTextContent("categories="));
});
