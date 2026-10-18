// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { FinanceCashflowPage } from "./cashflow-page";

const api = vi.hoisted(() => ({
  getMe: vi.fn(),
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
  api.getMe.mockResolvedValue({ planningTimezone: "America/New_York" });
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
        id: "22222222-2222-4222-8222-222222222222",
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
it("shows honest unavailable balance instead of legacy compatibility forecast totals", async () => {
  renderPage();
  expect(await screen.findByRole("region", { name: "Upcoming money" })).toBeVisible();
  expect(screen.getByText(/Projected balance unavailable/)).toBeVisible();
  expect(screen.queryByText("$79,000.00")).not.toBeInTheDocument();
  expect(api.getFinanceForecast).not.toHaveBeenCalled();
  expect(api.getFinanceSnapshot).not.toHaveBeenCalled();
});
it("retains schedule inspection when account details fail", async () => {
  api.listFinanceAccounts.mockRejectedValue(new Error("Account scope is offline"));
  renderPage();
  expect(await screen.findByText("Timeline account details unavailable")).toBeVisible();
  expect(await screen.findByRole("region", { name: "Upcoming money" })).toBeVisible();
});
it.each([
  "outlook",
  "income",
  "subscriptions",
])("does not claim recurring activity is empty when its source fails in %s", async (view) => {
  api.listFinanceRecurringItems.mockRejectedValue(new Error("Recurring source is offline"));
  renderPage(`/finances/cashflow?view=${view}`);
  expect(await screen.findByText("Recurring activity unavailable")).toBeVisible();
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
  expect(
    await screen.findByText(/Couldn’t confirm whether we could save this recurring payment/),
  ).toBeVisible();
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
          id: "11111111-1111-4111-8111-111111111111",
          confidence: 1,
          source: "user",
          payer: "Employer",
          lastObservedDate: null,
          accountId: "22222222-2222-4222-8222-222222222222",
          displayName: "Paycheck",
          expectedAmount: 3000,
          cadence: "biweekly",
          nextExpectedDate: "2026-09-08",
          status: "active",
        },
        {
          id: "33333333-3333-4333-8333-333333333333",
          confidence: 1,
          source: "user",
          payer: "Employer",
          lastObservedDate: null,
          accountId: null,
          displayName: "Possible income",
          expectedAmount: 100,
          cadence: "monthly",
          nextExpectedDate: null,
          status: "needs_review",
        },
        {
          id: "44444444-4444-4444-8444-444444444444",
          confidence: 1,
          source: "user",
          payer: "Employer",
          lastObservedDate: null,
          accountId: null,
          displayName: "Old income",
          expectedAmount: 50,
          cadence: "monthly",
          nextExpectedDate: null,
          status: "paused",
        },
      ],
      obligations: [],
    },
  });
  api.manageFinanceRecurringItem.mockResolvedValue({ data: {} });
  renderPage("/finances/cashflow?view=unknown");
  expect(await screen.findByText("Upcoming money")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Cash flow view" }));
  await user.click(screen.getByRole("menuitemradio", { name: "Income" }));
  expect(await screen.findByText("Needs confirmation")).toBeVisible();
  expect(screen.getByText("Inactive")).toBeVisible();
  expect(screen.getByText(/Every two weeks/)).toBeVisible();
  expect(screen.getAllByText(/Date not established/)).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "Confirm Possible income" }));
  await user.click(screen.getByRole("button", { name: "Resume Old income" }));
  expect(api.manageFinanceRecurringItem).toHaveBeenCalledWith(
    expect.objectContaining({ operation: "resume" }),
  );
});

it("keeps the empty income view explicit", async () => {
  renderPage("/finances/cashflow?view=income");
  expect(await screen.findByText("No income patterns yet")).toBeVisible();
});
it("does not substitute another source for an unavailable target", async () => {
  renderPage("/finances/cashflow?view=income&record=11111111-1111-4111-8111-111111111111");
  expect(await screen.findByText("Selected income record unavailable")).toBeVisible();
  expect(screen.getByRole("link", { name: "Show all income" })).toBeVisible();
});
