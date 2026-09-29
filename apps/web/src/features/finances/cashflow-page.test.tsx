// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { FinanceCashflowPage } from "./cashflow-page";

const api = vi.hoisted(() => ({
  getFinanceSnapshot: vi.fn(),
  getFinanceForecast: vi.fn(),
  listFinanceAccounts: vi.fn(),
  listFinanceRecurringItems: vi.fn(),
  manageFinanceRecurringItem: vi.fn(),
  listFinanceReimbursements: vi.fn(),
}));
vi.mock("../../api.js", () => ({ api, errorMessage: (error: Error) => error.message }));
function renderPage(path = "/finances/cashflow") {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <FinanceCashflowPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  api.getFinanceSnapshot.mockResolvedValue({
    data: { ledger: { trustworthy: false } },
    communication: { requiredDisclosures: [{ message: "Confirm account ownership." }] },
  });
  api.getFinanceForecast.mockResolvedValue({
    safeToSpend: 80000,
    lowestProjectedBalance: 79000,
    lowestProjectedDate: "2026-09-10",
    projectedBalanceAtNextPayday: 82000,
    upcomingIncome: 3000,
    upcomingObligations: 1000,
    asOf: "2026-09-03T12:00:00Z",
  });
  api.listFinanceAccounts.mockResolvedValue({
    accounts: [
      {
        id: "cash-1",
        kind: "cash",
        includeInPlanning: true,
        ownershipType: "individual",
        ownershipShare: 1,
      },
    ],
  });
  api.listFinanceRecurringItems.mockResolvedValue({ data: { income: [], obligations: [] } });
  api.listFinanceReimbursements.mockResolvedValue({ reimbursements: [], unmatchedCredits: [] });
});
it("withholds forecast money when the ledger cannot support it", async () => {
  renderPage();
  expect(await screen.findByText("Confirm account ownership.")).toBeVisible();
  expect(screen.queryByText("$80,000.00")).not.toBeInTheDocument();
  expect(
    within(screen.getByRole("region", { name: "Cash outlook" })).getAllByText("Unavailable"),
  ).toHaveLength(3);
});
it("shows a supported forecast with an explicit date and separates it from spending capacity", async () => {
  api.getFinanceSnapshot.mockResolvedValue({
    data: { ledger: { trustworthy: true } },
    communication: { requiredDisclosures: [] },
  });
  renderPage();
  expect(await screen.findByText("$79,000.00")).toBeVisible();
  expect(screen.getByText(/Sep 10, 2026/)).toBeVisible();
  expect(screen.queryByText("Safe to spend")).not.toBeInTheDocument();
});
it.each([
  { label: "excluded", includeInPlanning: false, ownershipType: "individual", ownershipShare: 1 },
  { label: "joint", includeInPlanning: true, ownershipType: "joint", ownershipShare: 0.5 },
  { label: "unknown", includeInPlanning: true, ownershipType: "unknown", ownershipShare: null },
])("withholds full forecast amounts for $label cash despite a trustworthy snapshot", async (interpretation) => {
  api.getFinanceSnapshot.mockResolvedValue({
    data: { ledger: { trustworthy: true } },
    communication: { requiredDisclosures: [] },
  });
  api.listFinanceAccounts.mockResolvedValue({
    accounts: [{ id: "cash-1", kind: "cash", ...interpretation }],
  });
  renderPage();
  expect(await screen.findByText("Forecast unavailable for this account scope")).toBeVisible();
  const outlook = within(screen.getByRole("region", { name: "Cash outlook" }));
  expect(outlook.getAllByText("Unavailable")).toHaveLength(3);
  expect(outlook.queryByText("$79,000.00")).not.toBeInTheDocument();
  expect(outlook.queryByText("$3,000.00")).not.toBeInTheDocument();
});
it("withholds a forecast when an active obligation belongs to an excluded non-cash account", async () => {
  api.getFinanceSnapshot.mockResolvedValue({
    data: { ledger: { trustworthy: true } },
    communication: { requiredDisclosures: [] },
  });
  api.listFinanceAccounts.mockResolvedValue({
    accounts: [
      {
        id: "cash-1",
        kind: "cash",
        includeInPlanning: true,
        ownershipType: "individual",
        ownershipShare: 1,
      },
      {
        id: "card-1",
        kind: "debt",
        includeInPlanning: false,
        ownershipType: "individual",
        ownershipShare: 1,
      },
    ],
  });
  api.listFinanceRecurringItems.mockResolvedValue({
    data: {
      income: [],
      obligations: [
        {
          id: "bill-1",
          accountId: "card-1",
          displayName: "Excluded bill",
          expectedAmount: 1000,
          nextExpectedDate: "2026-09-10",
          status: "active",
          cadence: "monthly",
        },
      ],
    },
  });
  renderPage();
  expect(await screen.findByText("Forecast unavailable for this account scope")).toBeVisible();
  expect(screen.queryByText("$79,000.00")).not.toBeInTheDocument();
});
it("withholds forecast amounts when account scope cannot be loaded", async () => {
  api.getFinanceSnapshot.mockResolvedValue({
    data: { ledger: { trustworthy: true } },
    communication: { requiredDisclosures: [] },
  });
  api.listFinanceAccounts.mockRejectedValue(new Error("Account scope is offline"));
  renderPage();
  expect(await screen.findByText("Account scope is offline")).toBeVisible();
  expect(screen.queryByText("$79,000.00")).not.toBeInTheDocument();
});
it.each([
  "outlook",
  "income",
  "subscriptions",
])("does not claim recurring activity is empty when its source fails in %s", async (view) => {
  api.listFinanceRecurringItems.mockRejectedValue(new Error("Recurring source is offline"));
  renderPage(`/finances/cashflow?view=${view}`);
  expect(await screen.findByText("Recurring source is offline")).toBeVisible();
  expect(screen.queryByText("No confirmed upcoming activity")).not.toBeInTheDocument();
  expect(screen.queryByText("No income patterns yet")).not.toBeInTheDocument();
  expect(screen.queryByText("No bills or subscriptions yet")).not.toBeInTheDocument();
});
it("marks a subscription inactive only inside the forecast, with pending and failed state", async () => {
  api.listFinanceRecurringItems.mockResolvedValue({
    data: {
      income: [],
      obligations: [
        {
          id: "subscription-1",
          displayName: "Music",
          expectedAmount: 12,
          cadence: "monthly",
          kind: "subscription",
          nextExpectedDate: "2026-09-10",
          status: "active",
          confidence: 1,
          source: "user",
        },
      ],
    },
  });
  api.manageFinanceRecurringItem.mockRejectedValue(new Error("Could not save"));
  renderPage("/finances/subscriptions");
  expect(await screen.findByText("Music")).toBeVisible();
  await userEvent.setup().click(screen.getByRole("button", { name: "Pause Music" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not save");
  expect(api.manageFinanceRecurringItem).toHaveBeenCalledWith(
    expect.objectContaining({
      itemId: "subscription-1",
      itemType: "obligation",
      operation: "pause",
    }),
  );
  expect(screen.getByText(/does not cancel/)).toBeVisible();
});

it("falls back to outlook and exposes each recurring pattern state and direction", async () => {
  const user = userEvent.setup();
  api.getFinanceSnapshot.mockResolvedValue({
    data: { ledger: { trustworthy: true } },
    communication: { requiredDisclosures: [] },
  });
  api.listFinanceRecurringItems.mockResolvedValue({
    data: {
      income: [
        {
          id: "income-active",
          accountId: "cash-1",
          displayName: "Paycheck",
          expectedAmount: 3000,
          cadence: "fortnightly",
          nextExpectedDate: "2026-09-08",
          status: "active",
        },
        {
          id: "income-review",
          accountId: null,
          displayName: "Possible income",
          expectedAmount: 100,
          cadence: "monthly",
          nextExpectedDate: null,
          status: "needs_review",
        },
        {
          id: "income-paused",
          accountId: null,
          displayName: "Old income",
          expectedAmount: 50,
          cadence: "yearly",
          nextExpectedDate: null,
          status: "paused",
        },
      ],
      obligations: [],
    },
  });
  api.manageFinanceRecurringItem.mockResolvedValue({ data: {} });
  renderPage("/finances/cashflow?view=unknown");
  expect(await screen.findByText("Expected income")).toBeVisible();
  await user.click(screen.getByRole("tab", { name: "Income" }));
  expect(await screen.findByText("Needs confirmation")).toBeVisible();
  expect(screen.getByText("Inactive")).toBeVisible();
  expect(screen.getByText(/fortnightly/)).toBeVisible();
  expect(screen.getAllByText(/Date not established/)).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "Confirm Possible income" }));
  await user.click(screen.getByRole("button", { name: "Resume Old income" }));
  expect(api.manageFinanceRecurringItem).toHaveBeenCalledWith(
    expect.objectContaining({ operation: "resume" }),
  );
});

it("keeps independent outlook failures and empty pattern views explicit", async () => {
  api.getFinanceSnapshot.mockRejectedValue(new Error("Snapshot unavailable"));
  api.getFinanceForecast.mockRejectedValue(new Error("Forecast unavailable"));
  const { unmount } = renderPage();
  expect(await screen.findByText("Snapshot unavailable")).toBeVisible();
  expect(screen.getByText("Forecast unavailable")).toBeVisible();
  unmount();
  api.getFinanceSnapshot.mockResolvedValue({
    data: { ledger: { trustworthy: true } },
    communication: { requiredDisclosures: [] },
  });
  api.getFinanceForecast.mockResolvedValue({
    safeToSpend: 0,
    lowestProjectedBalance: 0,
    lowestProjectedDate: null,
    projectedBalanceAtNextPayday: null,
    upcomingIncome: 0,
    upcomingObligations: 0,
    asOf: "2026-09-03T12:00:00Z",
  });
  renderPage("/finances/cashflow?view=income");
  expect(await screen.findByText("No income patterns yet")).toBeVisible();
});
