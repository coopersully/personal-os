// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BudgetMetricCard,
  FinanceBudgetAllocationChart,
  FinanceBudgetDetailDialog,
  FinanceReviewItems,
  FinancesPage,
  SubscriptionsPanel,
  TransactionDetails,
} from "./page.js";

const api = vi.hoisted(() => ({
  createFinanceAccount: vi.fn(),
  createFinanceBudget: vi.fn(),
  createFinanceTransaction: vi.fn(),
  getFinanceBudgetPace: vi.fn(),
  getFinanceBudgetStatus: vi.fn(),
  getFinanceCategories: vi.fn(),
  getFinanceForecast: vi.fn(),
  getFinanceLedgerHealth: vi.fn(),
  getFinanceOverview: vi.fn(),
  getFinanceOverviewForAccounts: vi.fn(),
  getFinanceOverviewForMonth: vi.fn(),
  getFinancePlaybook: vi.fn(),
  getFinanceReviewQueue: vi.fn(),
  getFinanceStatus: vi.fn(),
  getFinanceWealthSummary: vi.fn(),
  getPlaidStatus: vi.fn(),
  exportFinanceData: vi.fn(),
  importFinanceCsv: vi.fn(),
  listFinanceActionReviews: vi.fn(),
  listFinanceAlerts: vi.fn(),
  listFinanceIncomeStreams: vi.fn(),
  listFinanceQuestions: vi.fn(),
  listFinanceRecurringObligations: vi.fn(),
  listFinanceReimbursements: vi.fn(),
  listFinanceTransactions: vi.fn(),
  resolveFinanceReview: vi.fn(),
  resolveFinanceAlert: vi.fn(),
  refreshFinanceInsights: vi.fn(),
  syncFinanceAccount: vi.fn(),
  updateFinanceIncomeStream: vi.fn(),
  updateFinanceRecurringObligation: vi.fn(),
  updateFinanceTransaction: vi.fn(),
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
  sessionStorage.clear();
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
  api.getFinancePlaybook.mockResolvedValue({
    assessment: { blockers: [], nextActions: [], readiness: "on_track", uncertainty: [] },
    playbook: { steps: [], version: "1.0.0" },
  });
  api.getPlaidStatus.mockResolvedValue({ available: false, items: [] });
  api.exportFinanceData.mockResolvedValue({
    accounts: [{ id: "account", name: "Checking" }],
    budgets: [{ category: "Dining", limit: 200 }],
    categories: [{ id: "dining", name: "Dining" }],
    transactions: [{ id: "transaction", merchant: 'Cafe, "North"', notes: null }],
  });
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
  api.resolveFinanceReview.mockResolvedValue({});
  api.createFinanceAccount.mockResolvedValue({});
  api.createFinanceBudget.mockResolvedValue({});
  api.createFinanceTransaction.mockResolvedValue({});
  api.importFinanceCsv.mockResolvedValue({ imported: 1, skipped: 0 });
  api.refreshFinanceInsights.mockResolvedValue({});
  api.resolveFinanceAlert.mockResolvedValue({});
  api.syncFinanceAccount.mockResolvedValue({});
  api.updateFinanceIncomeStream.mockResolvedValue({});
  api.updateFinanceRecurringObligation.mockResolvedValue({});
  api.updateFinanceTransaction.mockResolvedValue({});
});

describe("Finance section states", () => {
  it("renders the boundary states of reusable Finance summaries", () => {
    render(<BudgetMetricCard label="Observed" tone="success" value="$0.00" />);
    expect(screen.getByText("Observed")).toBeVisible();
    cleanup();

    render(<FinanceBudgetAllocationChart budgets={[]} />);
    expect(screen.getByText("No planned categories")).toBeVisible();
    cleanup();

    render(<SubscriptionsPanel items={[]} onUpdate={vi.fn()} />);
    expect(screen.getByText("No subscriptions detected")).toBeVisible();
    cleanup();

    render(
      <FinanceReviewItems
        cases={[]}
        isPending={false}
        onApprove={vi.fn()}
        onCategorize={vi.fn()}
        onConfirmTransfer={vi.fn()}
        onDefer={vi.fn()}
      />,
    );
    expect(screen.getByText("Nothing needs your judgment")).toBeVisible();
  });

  it("renders budget and transaction detail alternatives conservatively", () => {
    const transaction = {
      accountId: "checking",
      amount: 25,
      category: null,
      categoryConfidence: null,
      categorySource: null,
      createdAt: "2026-09-01T12:00:00.000Z",
      date: "2026-09-01",
      direction: "income",
      id: "refund",
      merchant: "Refund",
      merchantId: null,
      needsReview: false,
      notes: null,
      pending: false,
      rawMerchant: null,
      updatedAt: "2026-09-01T12:00:00.000Z",
    };
    render(
      <TransactionDetails
        isCategorizing={false}
        onBreakdown={vi.fn()}
        onCategorize={vi.fn()}
        transaction={transaction as never}
      />,
    );
    expect(screen.getByText("Not categorized")).toBeVisible();
    expect(screen.queryByText("Notes")).not.toBeInTheDocument();
    cleanup();

    render(
      <FinanceBudgetDetailDialog
        budgets={[]}
        detail={{ category: "Dining", kind: "category" }}
        month="2026-09"
        onOpenChange={vi.fn()}
        statuses={undefined}
        transactions={[transaction as never]}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Dining activity" })).toBeVisible();
    expect(screen.getByText("No expense transactions match this view yet.")).toBeVisible();
    cleanup();

    render(
      <FinanceBudgetDetailDialog
        budgets={[]}
        detail={{ kind: "overages" }}
        month="2026-09"
        onOpenChange={vi.fn()}
        transactions={[transaction as never]}
      />,
    );
    expect(screen.getByText("No categories are over plan.")).toBeVisible();
    cleanup();

    const expense = {
      ...transaction,
      amount: 20,
      category: "Dining",
      direction: "expense",
      id: "dining-expense",
      merchant: "Cafe",
      needsReview: true,
      notes: "Lunch",
      rawMerchant: "SQ CAFE",
    } as never;
    render(
      <FinanceBudgetDetailDialog
        budgets={[{ category: "Dining", limit: 10, month: "2026-09" }]}
        detail={{ kind: "overages" }}
        month="2026-09"
        onOpenChange={vi.fn()}
        statuses={[]}
        transactions={[expense, transaction as never]}
      />,
    );
    expect(screen.getByText("$10.00 over")).toBeVisible();
    expect(screen.getByText("Needs category review")).toBeInTheDocument();
    expect(screen.getByText("−$20.00")).toBeVisible();
  });

  it("distinguishes actionable review evidence and transfer decisions", async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    const onCategorize = vi.fn();
    const onConfirmTransfer = vi.fn();
    const onDefer = vi.fn();
    const baseTransaction = {
      accountId: "checking",
      amount: 12,
      category: "Dining",
      categoryId: "dining",
      categoryConfidence: 0.8,
      categorySource: "provider",
      createdAt: "2026-09-01T12:00:00.000Z",
      date: "2026-09-01",
      direction: "expense",
      merchant: "Cafe",
      merchantId: "merchant",
      needsReview: true,
      notes: null,
      pending: false,
      rawMerchant: "SQ CAFE",
      updatedAt: "2026-09-01T12:00:00.000Z",
    };
    const review = (id: string, reason: string, transaction: Record<string, unknown>) =>
      ({
        createdAt: "2026-09-01T12:00:00.000Z",
        id,
        rationale: id === "category" ? "Merchant history supports Dining." : null,
        reason,
        status: "pending",
        transaction,
        updatedAt: "2026-09-01T12:00:00.000Z",
      }) as never;
    render(
      <FinanceReviewItems
        cases={[
          review("category", "low_confidence", baseTransaction),
          review("transfer", "possible_transfer", {
            ...baseTransaction,
            category: null,
            categoryId: null,
            id: "transfer-transaction",
          }),
          review("unknown", "missing_category", {
            ...baseTransaction,
            category: null,
            categoryId: null,
            id: "unknown-transaction",
            rawMerchant: null,
          }),
        ]}
        isPending={false}
        onApprove={onApprove}
        onCategorize={onCategorize}
        onConfirmTransfer={onConfirmTransfer}
        onDefer={onDefer}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await user.click(screen.getByRole("button", { name: "Confirm transfer" }));
    await user.click(screen.getAllByRole("button", { name: "Change" })[0] as HTMLElement);
    await user.click(screen.getAllByRole("button", { name: "Set aside" })[0] as HTMLElement);
    expect(onApprove).toHaveBeenCalledOnce();
    expect(onConfirmTransfer).toHaveBeenCalledOnce();
    expect(onCategorize).toHaveBeenCalledOnce();
    expect(onDefer).toHaveBeenCalledOnce();
  });
  it("shows a playbook load failure without rendering an empty playbook", async () => {
    api.getFinancePlaybook.mockRejectedValueOnce(new Error("Playbook unavailable"));

    renderPage("/finances");

    expect(await screen.findByRole("alert")).toHaveTextContent("Playbook unavailable");
    expect(screen.queryByText("Wealth-building priorities")).not.toBeInTheDocument();
  });

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

  it("renders populated insights, recurring work, budgets, and transaction evidence", async () => {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const transactions = [
      {
        accountId: "checking",
        amount: 84.5,
        category: "Dining",
        categoryConfidence: 0.82,
        categorySource: "merchant_rule",
        createdAt: "2026-08-20T12:00:00.000Z",
        date: "2026-08-20",
        direction: "expense",
        id: "expense",
        merchant: "Corner Bistro",
        merchantId: "merchant",
        needsReview: true,
        notes: "Team dinner",
        pending: false,
        rawMerchant: "SQ *CORNER BISTRO",
        updatedAt: "2026-08-20T12:00:00.000Z",
      },
      {
        accountId: "checking",
        amount: 2500,
        category: null,
        categoryConfidence: null,
        categorySource: null,
        createdAt: "2026-08-19T12:00:00.000Z",
        date: "2026-08-19",
        direction: "income",
        id: "income",
        merchant: "Payroll",
        merchantId: null,
        needsReview: false,
        notes: null,
        pending: false,
        updatedAt: "2026-08-19T12:00:00.000Z",
      },
      {
        accountId: "checking",
        amount: 200,
        category: "TRANSFER_OUT",
        categoryConfidence: 1,
        categorySource: "user",
        createdAt: "2026-08-18T12:00:00.000Z",
        date: "2026-08-18",
        direction: "transfer",
        id: "transfer",
        merchant: "Savings transfer",
        merchantId: "transfer-merchant",
        needsReview: false,
        notes: null,
        pending: false,
        updatedAt: "2026-08-18T12:00:00.000Z",
      },
    ];
    const overview = {
      accounts: [
        {
          balance: 1800,
          createdAt: "2026-08-01T12:00:00.000Z",
          id: "checking",
          institution: "Local Bank",
          kind: "cash",
          lastSyncedAt: "2026-08-23T12:00:00.000Z",
          name: "Checking",
          provider: "plaid",
          status: "connected",
          updatedAt: "2026-08-23T12:00:00.000Z",
        },
        {
          balance: 5000,
          createdAt: "2026-08-01T12:00:00.000Z",
          id: "brokerage",
          institution: "Broker",
          kind: "investment",
          lastSyncedAt: null,
          name: "Brokerage",
          provider: "manual",
          status: "manual",
          updatedAt: "2026-08-23T12:00:00.000Z",
        },
      ],
      budgets: [
        {
          category: "Dining",
          createdAt: "2026-08-01",
          id: "dining",
          limit: 100,
          month: currentMonth,
          updatedAt: "2026-08-01",
        },
        {
          category: "Travel",
          createdAt: "2026-08-01",
          id: "travel",
          limit: 50,
          month: currentMonth,
          updatedAt: "2026-08-01",
        },
        {
          category: "Misc",
          createdAt: "2026-08-01",
          id: "zero",
          limit: 0,
          month: currentMonth,
          updatedAt: "2026-08-01",
        },
      ],
      pendingSpendThisMonth: 25,
      refundCreditsThisMonth: 40,
      reviewCount: 1,
      spendingThisMonth: 284.5,
      transactions,
    };
    api.getFinanceOverview.mockResolvedValue(overview);
    api.getFinanceOverviewForMonth.mockResolvedValue(overview);
    api.listFinanceTransactions.mockResolvedValue({ items: transactions, nextCursor: "next-page" });
    api.getFinanceWealthSummary.mockResolvedValue({
      annualIncome: 90000,
      cash: 1800,
      debt: 1000,
      incomeBasis: "observed",
      investments: 5000,
      monthlyIncome: 7500,
      monthlyPlanRemaining: 266.5,
      netWorth: 5800,
      observedAnnualIncome: 90000,
      otherAssets: 0,
      plannedThisMonth: 150,
      statedAnnualIncome: 88000,
    });
    api.getFinanceStatus.mockResolvedValue({
      details: {
        cashFlow: { projectedLowestBalance: 725, projectedLowestBalanceDate: "2026-08-30" },
        evidence: { current: false },
        latestReview: { completedAt: "2026-08-22T12:00:00.000Z", id: "review" },
        month: { spending: 284.5 },
        reimbursements: { open: 2, outstanding: 125 },
      },
    });
    api.getFinanceLedgerHealth.mockResolvedValue({
      asOf: "2026-08-23T12:00:00.000Z",
      balanceOnlyAccounts: 0,
      candidateTransfers: 1,
      missingProvenance: 0,
      pendingTransactions: 2,
      possibleDuplicates: 0,
      staleAccounts: 0,
      unresolvedReviews: 0,
    });
    api.getFinanceBudgetStatus.mockResolvedValue([
      { budget: overview.budgets[0], remaining: 15.5, spent: 84.5 },
      { budget: overview.budgets[1], remaining: -25, spent: 75 },
      { budget: overview.budgets[2], remaining: 0, spent: 0 },
    ]);
    api.getFinanceForecast.mockResolvedValue({
      asOf: "2026-08-23T12:00:00.000Z",
      lowestProjectedBalance: 725,
      lowestProjectedDate: "2026-08-30",
      projectedBalanceAtNextPayday: 1200,
      safeToSpend: 450,
      upcomingIncome: 2500,
      upcomingObligations: 850,
    });
    api.listFinanceIncomeStreams.mockResolvedValue([
      {
        confidence: 0.95,
        displayName: "Salary",
        expectedAmount: 2500,
        id: "salary",
        nextExpectedDate: "2026-08-30",
        status: "active",
      },
      {
        confidence: 0.7,
        displayName: "Contract work",
        expectedAmount: 400,
        id: "contract",
        nextExpectedDate: null,
        status: "needs_review",
      },
    ]);
    api.listFinanceRecurringObligations.mockResolvedValue([
      {
        cadence: "monthly",
        confidence: 0.98,
        displayName: "Music",
        expectedAmount: 12,
        id: "music",
        kind: "subscription",
        nextExpectedDate: "2026-09-01",
        status: "active",
      },
      {
        cadence: "monthly",
        confidence: 0.75,
        displayName: "Gym",
        expectedAmount: 40,
        id: "gym",
        kind: "subscription",
        nextExpectedDate: null,
        status: "needs_review",
      },
      {
        cadence: "monthly",
        confidence: 0.9,
        displayName: "Paused video",
        expectedAmount: 15,
        id: "video",
        kind: "subscription",
        nextExpectedDate: null,
        status: "paused",
      },
      {
        cadence: "monthly",
        confidence: 0.9,
        displayName: "Rent",
        expectedAmount: 1500,
        id: "rent",
        kind: "bill",
        nextExpectedDate: "2026-09-01",
        status: "paused",
      },
    ]);
    api.listFinanceAlerts.mockResolvedValue([
      {
        body: "Dining is above its normal range.",
        id: "alert",
        severity: "warning",
        title: "Spending changed",
      },
    ]);

    const overviewView = renderPage("/finances");
    expect(await screen.findByText("Refresh sources before relying on totals")).toBeVisible();
    expect(screen.getByRole("link", { name: "Open review" })).toBeVisible();
    expect(screen.getByText("2 need attention")).toBeVisible();
    overviewView.unmount();

    const cashflowView = renderPage("/finances/cashflow");
    expect(await screen.findByText("Salary")).toBeVisible();
    expect(screen.getByText("Contract work")).toBeVisible();
    expect(screen.getByText("Spending changed")).toBeVisible();
    cashflowView.unmount();

    const subscriptionsView = renderPage("/finances/subscriptions");
    expect(await screen.findByText("Music")).toBeVisible();
    expect(screen.getByRole("button", { name: "Pause" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Resume" })).toBeVisible();
    subscriptionsView.unmount();

    const budgetView = renderPage("/finances/budgets");
    expect(await screen.findByRole("button", { name: "Edit budget" })).toBeVisible();
    expect(screen.getByText("Travel")).toBeVisible();
    expect(screen.getByText("Misc")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Planned: view contributing transactions" }),
    );
    expect(await screen.findByRole("dialog", { name: "Planned allocation" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Spent: view contributing transactions" }));
    expect(await screen.findByRole("dialog", { name: "Spending this month" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Over plan: view contributing transactions" }),
    );
    expect(await screen.findByRole("dialog", { name: "Over-plan activity" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Dining" }));
    expect(await screen.findByRole("dialog", { name: "Dining activity" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    budgetView.unmount();

    renderPage("/finances/transactions");
    expect(await screen.findByText("Corner Bistro")).toBeVisible();
    expect(screen.getByLabelText("Merchant entity needs review")).toBeVisible();
    const [detailsButton] = screen.getAllByRole("button", { name: "Details" });
    if (!detailsButton) throw new Error("Transaction details button was not rendered.");
    fireEvent.click(detailsButton);
    expect(await screen.findByText("Team dinner")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Categorize" }));
    const categorySelect = screen.getAllByLabelText("Category").at(-1);
    if (!categorySelect) throw new Error("Category selector was not rendered.");
    fireEvent.change(categorySelect, {
      target: { value: "Dining" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save category" }));
    await waitFor(() =>
      expect(api.updateFinanceTransaction).toHaveBeenCalledWith("expense", {
        category: "Dining",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    fireEvent.click(screen.getByRole("button", { name: "Sort by amount" }));
    fireEvent.click(await screen.findByRole("button", { name: "Sort by amount" }));
    fireEvent.click(await screen.findByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(api.listFinanceTransactions).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: "next-page" }),
      ),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Previous" }));
  }, 10_000);

  it("recovers browser account scopes and navigates unplanned budget months", async () => {
    sessionStorage.setItem("finance-account-scope:spend", "not-json");
    const malformed = renderPage("/finances");
    expect(await screen.findByText("Financial position")).toBeVisible();
    malformed.unmount();

    sessionStorage.setItem("finance-account-scope:spend", JSON.stringify("not-an-array"));
    const wrongShape = renderPage("/finances");
    expect(await screen.findByText("Financial position")).toBeVisible();
    wrongShape.unmount();

    const overview = {
      accounts: [
        {
          balance: 2500,
          createdAt: "2026-08-01T12:00:00.000Z",
          id: "investment",
          institution: "Broker",
          kind: "investment",
          lastSyncedAt: null,
          name: "Brokerage",
          provider: "manual",
          status: "manual",
          updatedAt: "2026-08-23T12:00:00.000Z",
        },
      ],
      budgets: [],
      pendingSpendThisMonth: 0,
      refundCreditsThisMonth: 0,
      reviewCount: 0,
      spendingThisMonth: 100,
      transactions: [],
    };
    sessionStorage.setItem("finance-account-scope:spend", JSON.stringify([]));
    api.getFinanceOverview.mockResolvedValue(overview);
    api.getFinanceOverviewForMonth.mockResolvedValue(overview);
    api.getFinanceOverviewForAccounts.mockResolvedValue({ ...overview, spendingThisMonth: 0 });
    api.getFinanceWealthSummary.mockResolvedValue({
      annualIncome: 0,
      cash: 75,
      debt: 0,
      incomeBasis: "none",
      investments: 2500,
      monthlyIncome: 0,
      monthlyPlanRemaining: null,
      netWorth: 2575,
      observedAnnualIncome: 0,
      otherAssets: 0,
      plannedThisMonth: 0,
      statedAnnualIncome: null,
    });
    api.getFinanceLedgerHealth.mockResolvedValue({
      asOf: "2026-08-23T12:00:00.000Z",
      balanceOnlyAccounts: 0,
      candidateTransfers: 1,
      missingProvenance: 0,
      pendingTransactions: 0,
      possibleDuplicates: 0,
      staleAccounts: 0,
      unresolvedReviews: 0,
    });
    const scoped = renderPage("/finances");
    expect(await screen.findByText("1 need attention")).toBeVisible();
    await waitFor(() =>
      expect(api.getFinanceOverviewForAccounts).toHaveBeenCalledWith(expect.any(String), []),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Spent this month: configure included accounts" }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Accounts included in spending" }),
    ).toBeVisible();
    fireEvent.click(screen.getByLabelText(/Brokerage/));
    expect(sessionStorage.getItem("finance-account-scope:spend")).toBe(
      JSON.stringify(["investment"]),
    );
    scoped.unmount();

    const budgets = renderPage("/finances/budgets");
    expect(await screen.findByRole("button", { name: "Next month" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    expect(await screen.findByText(/This future month has not been planned yet/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
    budgets.unmount();
  });

  it("keeps pending insights, ledger failures, and transfer evidence explicit", async () => {
    api.listFinanceAlerts.mockReturnValue(new Promise(() => undefined));
    api.listFinanceIncomeStreams.mockReturnValue(new Promise(() => undefined));
    api.listFinanceRecurringObligations.mockReturnValue(new Promise(() => undefined));
    api.getFinanceForecast.mockReturnValue(new Promise(() => undefined));
    const pending = renderPage("/finances/cashflow");
    expect(await screen.findByText("Safe to spend")).toBeVisible();
    expect(screen.getAllByText("$0.00").length).toBeGreaterThan(0);
    pending.unmount();

    api.getFinanceLedgerHealth.mockRejectedValue(new Error("Ledger unavailable"));
    const failed = renderPage("/finances/health");
    expect(await screen.findByRole("alert")).toHaveTextContent("Ledger unavailable");
    failed.unmount();

    api.getFinanceCategories.mockResolvedValue([
      {
        color: null,
        group: "Transfers",
        id: "transfer-category",
        isSystem: true,
        name: "Transfers",
        slug: "transfers",
      },
    ]);
    api.getFinanceReviewQueue.mockResolvedValue([
      {
        createdAt: "2026-08-23T12:00:00.000Z",
        id: "transfer-review",
        rationale: "Two owned accounts may be involved.",
        reason: "possible_transfer",
        status: "open",
        suggestedCategory: "Transfers",
        transaction: {
          accountId: "checking",
          amount: 250,
          category: "Transfers",
          categoryConfidence: 0.8,
          createdAt: "2026-08-23T12:00:00.000Z",
          date: "2026-08-23",
          direction: "expense",
          id: "transfer-transaction",
          merchant: "Account movement",
          merchantId: null,
          needsReview: true,
          notes: null,
          pending: false,
          providerDirection: "income",
          rawMerchant: null,
          updatedAt: "2026-08-23T12:00:00.000Z",
        },
      },
    ]);
    const review = renderPage("/finances/review");
    expect(await screen.findByText("Account movement")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(
      await screen.findByRole("dialog", { name: /Categorize Account movement/ }),
    ).toBeVisible();
    expect(screen.getByText(/possible transfer/i)).toBeVisible();
    fireEvent.change(screen.getByLabelText("Treat this transaction as"), {
      target: { value: "expense" },
    });
    fireEvent.click(screen.getByRole("switch", { name: /Always use this category/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save category" }));
    await waitFor(() =>
      expect(api.resolveFinanceReview).toHaveBeenCalledWith(
        "transfer-review",
        expect.objectContaining({
          action: "recategorize",
          learnMerchant: "always",
          nonTransferDirection: "expense",
        }),
      ),
    );
    review.unmount();
  });

  it("supports every retained review-queue decision without hiding its evidence", async () => {
    const transaction = {
      accountId: "checking",
      amount: 42,
      category: "Dining",
      categoryConfidence: 0.8,
      categoryId: "dining",
      categorySource: "model",
      createdAt: "2026-08-23T12:00:00.000Z",
      date: "2026-08-23",
      direction: "expense",
      id: "meal",
      merchant: "Cafe",
      merchantId: "cafe",
      needsReview: true,
      notes: null,
      pending: false,
      providerDirection: "expense",
      rawMerchant: "SQ CAFE",
      updatedAt: "2026-08-23T12:00:00.000Z",
    };
    api.getFinanceCategories.mockResolvedValue([
      {
        color: null,
        group: "Spending",
        id: "dining",
        isSystem: true,
        name: "Dining",
        slug: "dining",
      },
    ]);
    api.getFinanceReviewQueue.mockResolvedValue([
      {
        createdAt: transaction.createdAt,
        id: "category-review",
        rationale: "The merchant matches prior meals.",
        reason: "low_confidence",
        status: "open",
        suggestedCategory: "Dining",
        transaction,
      },
      {
        createdAt: transaction.createdAt,
        id: "transfer-review",
        rationale: "Another owned account may be involved.",
        reason: "possible_transfer",
        status: "open",
        suggestedCategory: null,
        transaction: {
          ...transaction,
          category: null,
          categoryId: null,
          id: "movement",
          merchant: "Account movement",
        },
      },
    ]);

    renderPage("/finances/review/legacy");
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm transfer" }));
    for (const button of screen.getAllByRole("button", { name: "Set aside" }))
      fireEvent.click(button);
    await waitFor(() => {
      expect(api.resolveFinanceReview).toHaveBeenCalledWith(
        "category-review",
        expect.objectContaining({ action: "approve" }),
      );
      expect(api.resolveFinanceReview).toHaveBeenCalledWith(
        "transfer-review",
        expect.objectContaining({ action: "confirm_transfer" }),
      );
      expect(api.resolveFinanceReview).toHaveBeenCalledWith(
        "category-review",
        expect.objectContaining({ action: "defer" }),
      );
    });

    const changeCategory = screen.getAllByRole("button", { name: "Change" }).at(0);
    if (!changeCategory) throw new Error("Expected a category change action.");
    fireEvent.click(changeCategory);
    expect(await screen.findByRole("dialog", { name: /Categorize Cafe/ })).toBeVisible();
    const reviewCategory = document.getElementById("finance-review-category");
    if (!(reviewCategory instanceof HTMLInputElement))
      throw new Error("Expected the review category input.");
    fireEvent.change(reviewCategory, { target: { value: "Dining" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "View all" }));
    expect(await screen.findByRole("button", { name: "Review queue" })).toBeVisible();
  });

  it("sorts, expands, categorizes, splits, pages, and exports the transaction ledger", async () => {
    const browser = userEvent.setup();
    const transaction = {
      accountId: "checking",
      amount: 18.5,
      category: null,
      categoryConfidence: null,
      categoryId: null,
      categorySource: null,
      createdAt: "2026-08-23T12:00:00.000Z",
      date: "2026-08-23",
      direction: "expense",
      id: "meal",
      merchant: "Cafe",
      merchantId: null,
      needsReview: true,
      notes: "Lunch",
      pending: false,
      rawMerchant: "SQ CAFE",
      updatedAt: "2026-08-23T12:00:00.000Z",
    };
    api.listFinanceTransactions.mockResolvedValue({
      items: [transaction],
      nextCursor: "next-ledger-page",
    });
    api.getFinanceCategories.mockResolvedValue([
      {
        color: null,
        group: "Spending",
        id: "dining",
        isSystem: true,
        name: "Dining",
        slug: "dining",
      },
    ]);
    const createObjectUrl = vi.fn().mockReturnValue("blob:finance");
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectUrl });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectUrl });
    const linkClick = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    renderPage("/finances/transactions");
    await screen.findByRole("table", { name: "Transactions" });
    for (const label of ["date", "merchant", "amount", "date"]) {
      fireEvent.click(await screen.findByRole("button", { name: `Sort by ${label}` }));
      await screen.findByRole("table", { name: "Transactions" });
    }
    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(screen.getByText("SQ CAFE")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Categorize" }));
    expect(await screen.findByRole("dialog", { name: /Categorize Cafe/ })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Split purchase" }));
    expect(await screen.findByRole("dialog", { name: /Split Cafe/ })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(api.listFinanceTransactions).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: "next-ledger-page" }),
      ),
    );
    for (const item of ["Transactions", "Accounts", "Budget plan", "Categories"]) {
      await browser.click(screen.getByRole("button", { name: "Export data" }));
      await browser.click(await screen.findByRole("menuitem", { name: item }));
    }
    await waitFor(() => expect(api.exportFinanceData).toHaveBeenCalledTimes(4));
    expect(createObjectUrl).toHaveBeenCalledTimes(4);
    expect(revokeObjectUrl).toHaveBeenCalledTimes(4);
    expect(linkClick).toHaveBeenCalledTimes(4);
  });

  it("renders null evidence, cash scoping, and empty budget drill-downs conservatively", async () => {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const uncategorized = {
      accountId: "cash-null",
      amount: 120,
      category: null,
      categoryConfidence: null,
      categorySource: null,
      createdAt: "2026-08-20T12:00:00.000Z",
      date: `${currentMonth}-20`,
      direction: "expense",
      id: "uncategorized",
      merchant: "Unknown shop",
      merchantId: null,
      needsReview: false,
      notes: null,
      pending: false,
      rawMerchant: null,
      updatedAt: "2026-08-20T12:00:00.000Z",
    };
    const overview = {
      accounts: [
        {
          balance: null,
          createdAt: "2026-08-01T12:00:00.000Z",
          id: "cash-null",
          institution: "Cash Bank",
          kind: "cash",
          lastSyncedAt: null,
          name: "Unreported cash",
          provider: "manual",
          status: "manual",
          updatedAt: "2026-08-23T12:00:00.000Z",
        },
        {
          balance: 1000,
          createdAt: "2026-08-01T12:00:00.000Z",
          id: "investment",
          institution: "Broker",
          kind: "investment",
          lastSyncedAt: null,
          name: "Brokerage",
          provider: "manual",
          status: "manual",
          updatedAt: "2026-08-23T12:00:00.000Z",
        },
      ],
      budgets: [
        {
          category: "Dining",
          createdAt: "2026-08-01",
          id: "dining",
          limit: 100,
          month: currentMonth,
          updatedAt: "2026-08-01",
        },
      ],
      pendingSpendThisMonth: 0,
      refundCreditsThisMonth: 0,
      reviewCount: 0,
      spendingThisMonth: 120,
      transactions: [uncategorized],
    };
    api.getFinanceOverview.mockResolvedValue(overview);
    api.getFinanceOverviewForMonth.mockResolvedValue(overview);
    api.getFinanceOverviewForAccounts.mockResolvedValue(overview);
    api.getFinanceStatus.mockResolvedValue({
      details: {
        cashFlow: { projectedLowestBalance: null, projectedLowestBalanceDate: null },
        evidence: { current: true },
        latestReview: null,
        month: { spending: null },
        reimbursements: { open: 0, outstanding: 0 },
      },
    });
    api.getFinanceWealthSummary.mockResolvedValue({
      annualIncome: 60_000,
      cash: 0,
      debt: 0,
      incomeBasis: "stated",
      investments: 1000,
      monthlyIncome: 5000,
      monthlyPlanRemaining: null,
      netWorth: 1000,
      observedAnnualIncome: 0,
      otherAssets: 0,
      plannedThisMonth: 100,
      statedAnnualIncome: 60_000,
    });
    api.getFinanceBudgetStatus.mockResolvedValue(null);

    const overviewView = renderPage("/finances");
    expect(await screen.findByText(/stated monthly income/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Cash tracked: configure included accounts" }),
    );
    expect(await screen.findByRole("dialog", { name: "Accounts included in cash" })).toBeVisible();
    expect(screen.getByLabelText(/Unreported cash/)).toBeVisible();
    expect(screen.queryByLabelText(/Brokerage/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Unreported cash/));
    fireEvent.click(screen.getByLabelText(/Unreported cash/));
    overviewView.unmount();

    const budgets = renderPage("/finances/budgets");
    expect(await screen.findByText("Dining")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Over plan: view contributing transactions" }),
    );
    expect(await screen.findByText("No categories are over plan.")).toBeVisible();
    expect(screen.getByText("No expense transactions match this view yet.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Spent: view contributing transactions" }));
    expect((await screen.findAllByText("Unknown shop")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("Potential allocation issues"));
    expect((await screen.findAllByText("Uncategorized")).length).toBeGreaterThan(0);
    budgets.unmount();
  });

  it("executes the legacy Finance controls that remain available from compatibility routes", async () => {
    const account = {
      balance: 400,
      createdAt: "2026-08-01T12:00:00.000Z",
      id: "checking",
      institution: "Local Bank",
      kind: "cash",
      lastSyncedAt: "2026-08-23T12:00:00.000Z",
      name: "Checking",
      provider: "plaid",
      status: "connected",
      updatedAt: "2026-08-23T12:00:00.000Z",
    };
    const overview = {
      accounts: [account],
      budgets: [],
      pendingSpendThisMonth: 0,
      refundCreditsThisMonth: 0,
      reviewCount: 2,
      spendingThisMonth: 0,
      transactions: [],
    };
    api.getFinanceOverview.mockResolvedValue(overview);
    api.getFinanceOverviewForMonth.mockResolvedValue(overview);
    api.listFinanceIncomeStreams.mockResolvedValue([
      {
        confidence: 0.7,
        displayName: "Contract work",
        expectedAmount: 400,
        id: "contract",
        nextExpectedDate: null,
        status: "needs_review",
      },
    ]);
    api.listFinanceRecurringObligations.mockResolvedValue([
      {
        cadence: "monthly",
        confidence: 0.8,
        displayName: "Gym",
        expectedAmount: 40,
        id: "gym",
        kind: "subscription",
        nextExpectedDate: null,
        status: "needs_review",
      },
      {
        cadence: "monthly",
        confidence: 0.9,
        displayName: "Music",
        expectedAmount: 12,
        id: "music",
        kind: "subscription",
        nextExpectedDate: null,
        status: "active",
      },
      {
        cadence: "monthly",
        confidence: 0.9,
        displayName: "Video",
        expectedAmount: 15,
        id: "video",
        kind: "subscription",
        nextExpectedDate: null,
        status: "paused",
      },
    ]);
    api.listFinanceAlerts.mockResolvedValue([
      { body: "Review the new pattern.", id: "alert", severity: "info", title: "New pattern" },
    ]);

    const cashflow = renderPage("/finances/cashflow");
    fireEvent.click(await screen.findByRole("button", { name: "Refresh patterns" }));
    for (const button of screen.getAllByRole("button", { name: "Confirm" }))
      fireEvent.click(button);
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    await waitFor(() => {
      expect(api.refreshFinanceInsights).toHaveBeenCalled();
      expect(api.updateFinanceIncomeStream).toHaveBeenCalledWith("contract", { status: "active" });
      expect(api.updateFinanceRecurringObligation).toHaveBeenCalledWith("gym", {
        status: "active",
      });
      expect(api.resolveFinanceAlert).toHaveBeenCalledWith("alert", {
        action: "resolve",
        rationale: null,
      });
    });
    cashflow.unmount();

    const subscriptions = renderPage("/finances/subscriptions");
    await screen.findByText("Music");
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    const cancelSubscription = screen.getAllByRole("button", { name: "Cancel" }).at(0);
    if (!cancelSubscription) throw new Error("Expected a subscription cancellation action.");
    fireEvent.click(cancelSubscription);
    await waitFor(() => {
      expect(api.updateFinanceRecurringObligation).toHaveBeenCalledWith("music", {
        status: "paused",
      });
      expect(api.updateFinanceRecurringObligation).toHaveBeenCalledWith("video", {
        status: "active",
      });
      expect(api.updateFinanceRecurringObligation).toHaveBeenCalledWith("gym", {
        status: "cancelled",
      });
    });
    subscriptions.unmount();

    const accounts = renderPage("/finances/accounts");
    fireEvent.click(await screen.findByRole("button", { name: "Sync" }));
    fireEvent.click(screen.getByRole("button", { name: "Track account" }));
    fireEvent.change(screen.getByLabelText("Institution"), { target: { value: "Cash Box" } });
    fireEvent.change(screen.getByLabelText("Account name"), { target: { value: "Wallet" } });
    fireEvent.change(screen.getByLabelText("Source"), { target: { value: "venmo" } });
    fireEvent.change(screen.getByLabelText("Account type"), { target: { value: "other" } });
    fireEvent.change(screen.getByLabelText("Current balance"), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "Add account" }));
    await waitFor(() => {
      expect(api.syncFinanceAccount).toHaveBeenCalledWith("checking");
      expect(api.createFinanceAccount).toHaveBeenCalledWith({
        balance: 25,
        institution: "Cash Box",
        kind: "other",
        name: "Wallet",
        provider: "venmo",
      });
    });
    accounts.unmount();

    const transactions = renderPage("/finances/transactions");
    fireEvent.click(await screen.findByRole("button", { name: "New transaction" }));
    const transactionAccount = document.getElementById("finance-account-select");
    if (!(transactionAccount instanceof HTMLSelectElement))
      throw new Error("Expected the transaction account select.");
    fireEvent.change(transactionAccount, { target: { value: "checking" } });
    fireEvent.change(screen.getByLabelText("Merchant"), { target: { value: "Cafe" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "8.5" } });
    fireEvent.change(screen.getByLabelText("Category (optional)"), {
      target: { value: "Dining" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add transaction" }));
    await waitFor(() =>
      expect(api.createFinanceTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: "checking",
          amount: 8.5,
          category: "Dining",
          merchant: "Cafe",
        }),
      ),
    );
    transactions.unmount();

    const budget = renderPage("/finances/budgets");
    fireEvent.click(await screen.findByRole("button", { name: "Set a budget" }));
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "Dining" } });
    fireEvent.change(screen.getByLabelText("Monthly limit"), { target: { value: "125" } });
    fireEvent.click(screen.getByRole("button", { name: "Save budget" }));
    await waitFor(() =>
      expect(api.createFinanceBudget).toHaveBeenCalledWith(
        expect.objectContaining({ category: "Dining", limit: 125 }),
      ),
    );
    budget.unmount();
  }, 10_000);
});
