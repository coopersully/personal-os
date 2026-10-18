// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  type FinanceSpendingDashboard,
  type FinanceSpendingQuery,
  resolveWorkspaceSettings,
} from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "@/api";
import { FinanceSpendingPage } from "./spending-page";

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
  expect(screen.getByRole("button", { name: "Bubbles" })).toHaveAttribute("aria-pressed", "true");
  expect(api.updateWorkspaceSettings).not.toHaveBeenCalled();
});
it("restores saved List and persists only explicit account and view changes", async () => {
  mount();
  await screen.findByRole("button", { name: "Groceries" });
  expect(screen.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
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
  await waitFor(() => expect(screen.getByRole("button", { name: "Bubbles" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Bubbles" }));
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
  fireEvent.click(screen.getByText("Why these totals are qualified"));
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
  await waitFor(() => expect(api.getFinanceSpending).toHaveBeenCalledTimes(2));
  const queries = vi.mocked(api.getFinanceSpending).mock.calls.map(([query]) => query);
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
  expect(screen.getByText(/Last three calendar months/)).toBeVisible();
  const query = vi.mocked(api.getFinanceSpending).mock.calls[0]?.[0];
  if (!query) throw new Error("No Rhythm query");
  const start = new Date(`${query.scope.from}T12:00:00Z`),
    end = new Date(`${query.scope.through}T12:00:00Z`);
  expect(
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth(),
  ).toBe(2);
  const weekdays = screen.getAllByText(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/);
  expect(weekdays[0]).toHaveTextContent("Mon");
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
      groups: [{ groupId: "food", budgetCents: 10000, usedCents: 2500, overspent: false }],
    },
  }));
  mount("?view=list&period=today&from=2026-09-08");
  await screen.findByText("Observed monthly $25.00 of $100.00 · 25.0%");
  expect(screen.getByText(/2026-09-08 – 2026-09-08/)).toBeVisible();
  expect(screen.getByText(/America\/Chicago/)).toBeVisible();
  expect(screen.getByText(/Confirmed later/)).toBeVisible();
  expect(screen.queryByText("Confirm this month's budget scope")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Groceries" }));
  const detail = await screen.findByRole("dialog");
  expect(detail).toHaveTextContent("Monthly usage: $25.00 of $100.00");
  expect(detail).toHaveTextContent("whole qualified month");
  expect(detail).toHaveTextContent("Observed usage · historical coverage unknown");
});
