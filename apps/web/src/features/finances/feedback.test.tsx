import { resolveWorkspaceSettings } from "@personal-os/domain";
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api.js";
import { FinancesPage } from "./page.js";

vi.mock("react-plaid-link", () => ({ usePlaidLink: () => ({ open: vi.fn(), ready: false }) }));
afterEach(() => vi.restoreAllMocks());
describe("Finance form feedback", () => {
  it("validates account fields on submit and retains entered values after a failed save", async () => {
    vi.spyOn(api, "getFinanceOverview").mockResolvedValue({
      accounts: [],
      budgets: [],
      pendingSpendThisMonth: 0,
      refundCreditsThisMonth: 0,
      reviewCount: 0,
      spendingThisMonth: 0,
      transactions: [],
    });
    vi.spyOn(api, "getFinanceCategories").mockResolvedValue([]);
    vi.spyOn(api, "getPlaidStatus").mockResolvedValue({ available: false });
    vi.spyOn(api, "createFinanceAccount").mockRejectedValue(new Error("private database failure"));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/finances/accounts"]}>
          <FinancesPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Track account" }));
    await userEvent.click(screen.getByRole("button", { name: "Add account" }));
    expect(api.createFinanceAccount).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Institution")).toHaveAttribute("aria-invalid", "true");
    await userEvent.type(screen.getByLabelText("Institution"), "My bank");
    await userEvent.type(screen.getByLabelText("Account name"), "Checking");
    await userEvent.click(screen.getByRole("button", { name: "Add account" }));
    await waitFor(() => expect(api.createFinanceAccount).toHaveBeenCalledOnce());
    expect(await screen.findByText(/Couldn’t confirm/)).toBeInTheDocument();
    expect(screen.getByLabelText("Institution")).toHaveValue("My bank");
    expect(screen.getByLabelText("Account name")).toHaveValue("Checking");
    expect(screen.queryByText("private database failure")).not.toBeInTheDocument();
  });
});

const overview = {
  accounts: [],
  budgets: [],
  pendingSpendThisMonth: 0,
  refundCreditsThisMonth: 0,
  reviewCount: 0,
  spendingThisMonth: 0,
  transactions: [],
};
const queryDefaults = {
  getFinanceOverview: overview,
  getFinanceOverviewForMonth: overview,
  getFinanceOverviewForAccounts: overview,
  getFinanceCategories: [],
  getPlaidStatus: { available: false },
  getFinanceProfile: {
    effectiveDate: "2026-07-01",
    employer: "Saved employer",
    employmentType: null,
    expectedNetPay: null,
    grossAnnualIncome: null,
    nextPayday: null,
    payAccountId: null,
    payFrequency: null,
    role: null,
    updatedAt: "2026-07-01T00:00:00Z",
  },
  getFinanceWealthSummary: {
    annualIncome: 0,
    cash: 0,
    debt: 0,
    incomeBasis: "none",
    investments: 0,
    monthlyIncome: 0,
    monthlyPlanRemaining: null,
    netWorth: 0,
    observedAnnualIncome: 0,
    otherAssets: 0,
    plannedThisMonth: 0,
    statedAnnualIncome: null,
  },
  getFinanceBudgetPace: { asOf: "2026-07-13", cells: [], period: "week" },
  getFinanceLedgerHealth: {
    asOf: "2026-07-13",
    balanceOnlyAccounts: 0,
    candidateTransfers: 0,
    missingProvenance: 0,
    pendingTransactions: 0,
    possibleDuplicates: 0,
    staleAccounts: 0,
    unresolvedReviews: 0,
  },
  listFinanceIncomeStreams: [],
  listFinanceRecurringObligations: [],
  listFinanceAlerts: [],
  getFinanceForecast: {
    asOf: "2026-07-13",
    lowestProjectedBalance: 0,
    lowestProjectedDate: null,
    projectedBalanceAtNextPayday: null,
    safeToSpend: 0,
    upcomingIncome: 0,
    upcomingObligations: 0,
  },
  getFinanceBudgetStatus: [],
  getFinanceReviewQueue: [],
  listFinanceTransactions: { items: [], nextCursor: null },
};

const queryCases = [
  {
    method: "listFinanceTransactions",
    route: "transactions",
    title: "Couldn’t load transactions.",
    key: [
      "finance-transactions",
      null,
      { sortBy: "date", sortDirection: "desc" },
      { review: "all" },
    ],
  },
  {
    method: "listFinanceIncomeStreams",
    route: "cashflow",
    title: "Couldn’t load income streams.",
    key: ["finance-income-streams"],
  },
  {
    method: "listFinanceRecurringObligations",
    route: "subscriptions",
    title: "Couldn’t load recurring payments.",
    key: ["finance-recurring"],
  },
  {
    method: "listFinanceAlerts",
    route: "cashflow",
    title: "Couldn’t load financial alerts.",
    key: ["finance-alerts"],
  },
  {
    method: "getFinanceForecast",
    route: "cashflow",
    title: "Couldn’t load cash-flow forecast.",
    key: ["finance-forecast"],
  },
  {
    method: "getFinanceBudgetStatus",
    route: "budgets",
    title: "Couldn’t load budget status.",
    key: ["finance-budget-status", new Date().toISOString().slice(0, 7)],
  },
  {
    method: "getFinanceBudgetPace",
    route: "overview",
    title: "Couldn’t load budget pace.",
    key: ["finance-budget-pace", "week"],
  },
  {
    method: "getFinanceCategories",
    route: "accounts",
    title: "Couldn’t load categories.",
    key: ["finance-categories"],
  },
  {
    method: "getFinanceReviewQueue",
    route: "review",
    title: "Couldn’t load transaction review queue.",
    key: ["finance-review-queue", undefined],
  },
  {
    method: "getFinanceWealthSummary",
    route: "overview",
    title: "Couldn’t load wealth summary.",
    key: ["finance-wealth"],
  },
  {
    method: "getFinanceLedgerHealth",
    route: "overview",
    title: "Couldn’t load account health.",
    key: ["finance-ledger-health"],
  },
  {
    method: "getPlaidStatus",
    route: "accounts",
    title: "Couldn’t check bank connection availability.",
    key: ["plaid-status"],
  },
] as const;

function querySetup(route: string, cached?: { key: readonly unknown[]; value: unknown }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  if (cached) client.setQueryData(cached.key, cached.value);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/finances/${route}`]}>
        <FinancesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
function mockFinanceQueries() {
  vi.spyOn(api, "getWorkspaceSettings").mockResolvedValue(resolveWorkspaceSettings("finances"));
  for (const [method, value] of Object.entries(queryDefaults)) {
    vi.spyOn(api, method as keyof typeof queryDefaults).mockResolvedValue(value as never);
  }
}

describe("Finance query recovery", () => {
  it.each(queryCases)("retries $method in its affected panel after an initial failure", async ({
    method,
    route,
    title,
  }) => {
    mockFinanceQueries();
    const request = vi.mocked(api[method]);
    request.mockRejectedValueOnce(new Error("private provider details"));
    querySetup(route);
    const message = await screen.findByText(title);
    expect(screen.queryByText("private provider details")).not.toBeInTheDocument();
    const status = message.closest('[role="status"]');
    if (!status) throw new Error("Persistent query feedback is missing");
    await userEvent.click(within(status as HTMLElement).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByText(title)).not.toBeInTheDocument());
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each(
    queryCases.filter(({ method }) => method !== "getPlaidStatus"),
  )("retains cached $method and exposes background recovery", async ({
    method,
    route,
    title,
    key,
  }) => {
    mockFinanceQueries();
    const request = vi.mocked(api[method]);
    request.mockRejectedValueOnce(new Error("private background failure"));
    const data = queryDefaults[method];
    const client = querySetup(route, { key, value: data });
    const message = await screen.findByText(title);
    const status = message.closest('[role="status"]');
    if (!status) throw new Error("Persistent query feedback is missing");
    expect(
      within(status as HTMLElement).getByText(/Showing the last available update/),
    ).toBeInTheDocument();
    expect(client.getQueryData(key)).toEqual(data);

    await userEvent.click(within(status as HTMLElement).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByText(title)).not.toBeInTheDocument());
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("keeps a scoped spending failure visible until its selected-account query recovers", async () => {
    mockFinanceQueries();
    vi.mocked(api.getWorkspaceSettings).mockResolvedValue(
      resolveWorkspaceSettings("finances", { spendAccountIds: [] }),
    );
    vi.mocked(api.getFinanceOverview).mockResolvedValue({
      ...overview,
      accounts: [{ id: "selected-account", kind: "cash" }] as never,
    });
    try {
      vi.mocked(api.getFinanceOverviewForAccounts).mockRejectedValueOnce(
        new Error("scoped spending unavailable"),
      );
      querySetup("overview");
      const message = await screen.findByText("Couldn’t load account spending.");
      await userEvent.click(
        within(message.closest('[role="status"]') as HTMLElement).getByRole("button", {
          name: "Try again",
        }),
      );
      await waitFor(() =>
        expect(screen.queryByText("Couldn’t load account spending.")).not.toBeInTheDocument(),
      );
      expect(api.getFinanceOverviewForAccounts).toHaveBeenCalledTimes(2);
    } finally {
      vi.mocked(api.getWorkspaceSettings).mockReset();
    }
  });

  it("recovers the initial finance overview and retains it after a later refresh failure", async () => {
    mockFinanceQueries();
    vi.mocked(api.getFinanceOverview).mockRejectedValueOnce(new Error("private overview failure"));
    const client = querySetup("accounts");
    const initial = await screen.findByText("Couldn’t load your finances.");
    await userEvent.click(
      within(initial.closest('[role="status"]') as HTMLElement).getByRole("button", {
        name: "Try again",
      }),
    );
    expect(await screen.findByRole("button", { name: "Track account" })).toBeInTheDocument();
    vi.mocked(api.getFinanceOverview).mockRejectedValueOnce(new Error("private refresh failure"));
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["finance-overview"] });
    });
    const stale = await screen.findByText("Couldn’t refresh your finances.");
    expect(screen.getByRole("button", { name: "Track account" })).toBeInTheDocument();
    await userEvent.click(
      within(stale.closest('[role="status"]') as HTMLElement).getByRole("button", {
        name: "Try again",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByText("Couldn’t refresh your finances.")).not.toBeInTheDocument(),
    );
  });
});
