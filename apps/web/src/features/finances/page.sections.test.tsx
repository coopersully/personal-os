// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FinancesPage } from "./page.js";

const api = vi.hoisted(() => ({
  getFinanceBudgetPace: vi.fn(),
  getFinanceBudgetStatus: vi.fn(),
  getFinanceCategories: vi.fn(),
  getFinanceForecast: vi.fn(),
  getFinanceLedgerHealth: vi.fn(),
  getFinanceOverview: vi.fn(),
  getFinanceOverviewForAccounts: vi.fn(),
  getFinanceOverviewForMonth: vi.fn(),
  getFinanceReviewQueue: vi.fn(),
  getFinanceStatus: vi.fn(),
  getFinanceWealthSummary: vi.fn(),
  getPlaidStatus: vi.fn(),
  listFinanceActionReviews: vi.fn(),
  listFinanceAlerts: vi.fn(),
  listFinanceIncomeStreams: vi.fn(),
  listFinanceQuestions: vi.fn(),
  listFinanceRecurringObligations: vi.fn(),
  listFinanceReimbursements: vi.fn(),
  listFinanceTransactions: vi.fn(),
}));

vi.mock("../../api.js", () => ({
  api,
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : "Unknown error"),
}));

function renderPage(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <FinancesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  const overview = {
    accounts: [],
    budgets: [],
    pendingSpendThisMonth: 0,
    refundCreditsThisMonth: 0,
    reviewCount: 0,
    spendingThisMonth: 0,
    transactions: [],
  };
  api.getFinanceOverview.mockResolvedValue(overview);
  api.getFinanceOverviewForMonth.mockResolvedValue(overview);
  api.getFinanceOverviewForAccounts.mockResolvedValue(overview);
  api.getPlaidStatus.mockResolvedValue({ available: false, items: [] });
  api.getFinanceWealthSummary.mockResolvedValue({
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
  });
  api.getFinanceStatus.mockResolvedValue({
    details: {
      cashFlow: { projectedLowestBalance: 0, projectedLowestBalanceDate: null },
      evidence: { current: true },
      latestReview: null,
      month: { spending: 0 },
      reimbursements: { open: 0, outstanding: 0 },
    },
  });
  api.getFinanceLedgerHealth.mockResolvedValue({
    asOf: "2026-08-23T12:00:00.000Z",
    balanceOnlyAccounts: 0,
    candidateTransfers: 0,
    missingProvenance: 0,
    pendingTransactions: 0,
    possibleDuplicates: 0,
    staleAccounts: 0,
    unresolvedReviews: 0,
  });
  api.getFinanceBudgetPace.mockResolvedValue({ asOf: "2026-08-23", cells: [], period: "week" });
  api.getFinanceBudgetStatus.mockResolvedValue([]);
  api.getFinanceCategories.mockResolvedValue([]);
  api.getFinanceForecast.mockResolvedValue({
    asOf: "2026-08-23T12:00:00.000Z",
    lowestProjectedBalance: 0,
    lowestProjectedDate: null,
    projectedBalanceAtNextPayday: null,
    safeToSpend: 0,
    upcomingIncome: 0,
    upcomingObligations: 0,
  });
  api.getFinanceReviewQueue.mockResolvedValue([]);
  api.listFinanceActionReviews.mockResolvedValue([]);
  api.listFinanceAlerts.mockResolvedValue([]);
  api.listFinanceIncomeStreams.mockResolvedValue([]);
  api.listFinanceQuestions.mockResolvedValue([]);
  api.listFinanceRecurringObligations.mockResolvedValue([]);
  api.listFinanceReimbursements.mockResolvedValue({ reimbursements: [], unmatchedCredits: [] });
  api.listFinanceTransactions.mockResolvedValue({ items: [], nextCursor: null });
});

describe("Finance section states", () => {
  it("renders the empty but usable overview", async () => {
    renderPage("/finances");
    expect(await screen.findByText("Financial position")).toBeVisible();
    expect(screen.getByText("Nothing to review")).toBeVisible();
  });

  it("keeps specialized sections explicit with no ledger rows", async () => {
    const { unmount } = renderPage("/finances/cashflow");
    expect(await screen.findByText("Safe to spend")).toBeVisible();
    unmount();
    renderPage("/finances/budgets");
    expect(await screen.findByRole("button", { name: "Set a budget" })).toBeVisible();
  });

  it("shows health and review work empty states without hiding the controls", async () => {
    const { unmount } = renderPage("/finances/health");
    expect(await screen.findByText("Ledger health")).toBeVisible();
    unmount();
    renderPage("/finances/review");
    expect(await screen.findByText("Nothing needs review")).toBeVisible();
  });
});
