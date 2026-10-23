import { toast } from "sonner";
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { ApiClientError } from "@personal-os/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FinanceOverviewPage } from "./overview-page";

const api = vi.hoisted(() => ({
  getMe: vi.fn(),
  listAgentAccessWorkItems: vi.fn(),
  getFinanceSnapshot: vi.fn(),
  getFinanceBudget: vi.fn(),
  getFinanceInbox: vi.fn(),
  getFinanceStatus: vi.fn(),
  getFinancePlaybook: vi.fn(),
  getFinanceMaintenanceHistory: vi.fn(),
  listFinanceRecurringOccurrences: vi.fn(),
}));
vi.mock("../../api.js", () => ({ api }));
vi.mock("./overview-settings", () => ({ FinanceOverviewSettings: () => null }));
const envelope = (data: unknown) => ({
  data,
  outcome: "completed",
  communication: { requiredDisclosures: [] },
});
const occurrence = (key: string, extra = {}) => ({
  key,
  occurrenceId: null,
  scheduleVersionId: "schedule-1",
  source: { kind: "income", id: "source-1" },
  sourceRevision: 1,
  accountId: null,
  displayName: key,
  localDate: "2026-10-20",
  slot: 0,
  expectedAmountCents: 2000,
  currencyCode: "USD",
  amountBasis: "fixed",
  certainty: "expected",
  inCurrentSchedule: true,
  matchState: "expected",
  matchedAmountCents: 0,
  remainingExpectedCents: 2000,
  matchIds: [],
  ...extra,
});
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter>
          <FinanceOverviewPage />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return client;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-20T01:00:00Z"));
  api.getMe.mockResolvedValue({ id: "owner-a", planningTimezone: "America/New_York" });
  api.getFinanceSnapshot.mockResolvedValue(
    envelope({
      asOf: "2026-10-19T12:00:00Z",
      cash: null,
      netWorth: null,
      budget: { spent: null },
      ledger: { trustworthy: false, reconciledThrough: null },
    }),
  );
  api.getFinanceBudget.mockResolvedValue(envelope(null));
  api.getFinanceInbox.mockResolvedValue(envelope([]));
  api.listAgentAccessWorkItems.mockResolvedValue({
    summary: { byDomain: { finances: 0 } },
    unavailableDomains: [],
    items: [],
    nextCursor: null,
  });
  api.getFinanceStatus.mockResolvedValue({
    details: { latestReview: null, reimbursements: { outstanding: 0 } },
  });
  api.getFinancePlaybook.mockResolvedValue({ assessment: { blockers: [], nextActions: [] } });
  api.getFinanceMaintenanceHistory.mockResolvedValue({ items: [] });
  api.listFinanceRecurringOccurrences.mockResolvedValue({
    occurrences: [],
    unavailableSources: [],
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("omits the duplicate decision summary while keeping supporting navigation", async () => {
  api.getFinanceInbox.mockResolvedValue(envelope([]));
  api.listAgentAccessWorkItems.mockResolvedValue({
    summary: { byDomain: { finances: 3 } },
    unavailableDomains: [],
    items: [{ id: "canonical-transaction", title: "Private first review question" }],
    nextCursor: null,
  });
  mount();
  await screen.findByRole("region", { name: "Coming next" });
  expect(screen.queryByRole("region", { name: "Needs you" })).not.toBeInTheDocument();
  expect(screen.queryByText("Private first review question")).not.toBeInTheDocument();
  expect(api.getFinanceInbox).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(api.listAgentAccessWorkItems).toHaveBeenCalledWith({ domain: "finances", limit: 10 }),
  );
  expect(screen.getByRole("link", { name: "Open Activity" })).toHaveAttribute(
    "href",
    "/finances/activity",
  );
  expect(screen.getByRole("link", { name: "Explore Spending" })).toHaveAttribute(
    "href",
    "/finances/spending",
  );
});

it("uses the owner's local dates and preserves remaining amounts, currencies and occurrence history", async () => {
  api.listFinanceRecurringOccurrences.mockResolvedValue({
    occurrences: [
      occurrence("Later", { localDate: "2026-11-01" }),
      occurrence("Partial bill", {
        source: { kind: "obligation", id: "b" },
        matchState: "partially_matched",
        remainingExpectedCents: 1250,
        currencyCode: "EUR",
      }),
      occurrence("Already matched", { matchState: "matched" }),
      occurrence("Invalidated", { matchState: "invalidated" }),
      occurrence("Historical", { inCurrentSchedule: false }),
    ],
    unavailableSources: [],
  });
  const client = mount();
  const next = await screen.findByRole("region", { name: "Coming next" });
  await within(next).findByText("Partial bill");
  expect(api.listFinanceRecurringOccurrences).toHaveBeenCalledWith({
    from: "2026-10-19",
    to: "2026-11-17",
  });
  expect(
    client.getQueryData([
      "finance-recurring-occurrences",
      "owner-a",
      "America/New_York",
      { from: "2026-10-19", to: "2026-11-17" },
    ]),
  ).toBeDefined();
  expect(within(next).getByText("−€12.50")).toBeVisible();
  expect(within(next).getByText(/Remaining after partial match/)).toBeVisible();
  expect(
    within(next).queryByText(/Already matched|Invalidated|Historical/),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open upcoming money" })).toHaveAttribute(
    "href",
    "/finances/cashflow?cashflowFrom=2026-10-19&cashflowTo=2026-11-17&timeline=agenda",
  );
});

it("distinguishes empty schedules, incomplete evidence and variable amounts", async () => {
  api.listFinanceRecurringOccurrences.mockResolvedValue({
    occurrences: [
      occurrence("Variable bill", {
        amountBasis: "variable",
        remainingExpectedCents: null,
        expectedAmountCents: null,
        currencyCode: "GBP",
      }),
    ],
    unavailableSources: [{ reason: "unconfirmed_schedule" }],
  });
  mount();
  expect(await screen.findByText("Amount varies")).toBeVisible();
  expect(screen.getByText(/1 sources need schedule or amount confirmation/)).toBeVisible();
  expect(
    screen.queryByText("No unmatched scheduled money in this date range."),
  ).not.toBeInTheDocument();
});

it("does not claim an empty schedule or all-clear decisions on failed reads", async () => {
  api.listAgentAccessWorkItems.mockRejectedValue(new Error("offline"));
  api.listFinanceRecurringOccurrences.mockRejectedValue(new Error("offline"));
  mount();
  expect(await screen.findByText("Upcoming money unavailable")).toBeVisible();
  expect(screen.queryByRole("region", { name: "Next step" })).not.toBeInTheDocument();
  expect(screen.queryByText("No items need review")).not.toBeInTheDocument();
  expect(
    screen.queryByText("No unmatched scheduled money in this date range."),
  ).not.toBeInTheDocument();
});

it("hides cached occurrences after an access denial and keeps transient failures honest", async () => {
  api.listFinanceRecurringOccurrences.mockResolvedValue({
    occurrences: [occurrence("Private salary")],
    unavailableSources: [],
  });
  const client = mount();
  await screen.findByText("Private salary");
  api.listFinanceRecurringOccurrences.mockRejectedValue(new Error("offline"));
  await client.invalidateQueries({ queryKey: ["finance-recurring-occurrences"] });
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  expect(screen.queryByText(/Showing the last available update/)).not.toBeInTheDocument();
  expect(screen.getByText("Private salary")).toBeVisible();
  api.listFinanceRecurringOccurrences.mockRejectedValue(
    new ApiClientError({ status: 403, message: "Forbidden", code: "denied" }),
  );
  await client.invalidateQueries({ queryKey: ["finance-recurring-occurrences"] });
  await waitFor(() => expect(screen.queryByText("Private salary")).not.toBeInTheDocument());
  expect(screen.getByText("Upcoming money access unavailable.")).toBeVisible();
});

it("does not show another owner's cached or late arriving schedule", async () => {
  let finishOld: ((value: unknown) => void) | undefined;
  api.listFinanceRecurringOccurrences.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      }),
  );
  const client = mount();
  await waitFor(() => expect(api.listFinanceRecurringOccurrences).toHaveBeenCalledTimes(1));
  api.listFinanceRecurringOccurrences.mockResolvedValue({
    occurrences: [occurrence("New owner salary")],
    unavailableSources: [],
  });
  act(() => client.setQueryData(["me"], { id: "owner-b", planningTimezone: "Europe/London" }));
  await screen.findByText("New owner salary");
  await act(async () =>
    finishOld?.({ occurrences: [occurrence("Old owner salary")], unavailableSources: [] }),
  );
  expect(screen.queryByText("Old owner salary")).not.toBeInTheDocument();
  expect(api.listFinanceRecurringOccurrences).toHaveBeenLastCalledWith({
    from: "2026-10-20",
    to: "2026-11-18",
  });
});

it("waits for a planning timezone without guessing upcoming dates", async () => {
  api.getMe.mockResolvedValue({ id: "owner-a", planningTimezone: null });
  mount();
  expect(await screen.findByText(/Set your planning timezone/)).toBeVisible();
  expect(api.listFinanceRecurringOccurrences).not.toHaveBeenCalled();
  expect(
    screen.queryByText("No unmatched scheduled money in this date range."),
  ).not.toBeInTheDocument();
});

it("withholds an all-clear and next-step advice when canonical review coverage is unavailable", async () => {
  api.listAgentAccessWorkItems.mockResolvedValue({
    summary: { byDomain: { finances: 0 } },
    unavailableDomains: ["finances"],
    items: [],
    nextCursor: null,
  });
  mount();
  await waitFor(() => expect(api.listAgentAccessWorkItems).toHaveBeenCalled());
  expect(screen.queryByText("No items need review")).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Next step" })).not.toBeInTheDocument();
});

it.each([
  "unconfirmed_schedule",
  "source_changed",
])("does not call an empty occurrence list clear when a source is %s", async (reason) => {
  api.listFinanceRecurringOccurrences.mockResolvedValue({
    occurrences: [],
    unavailableSources: [{ reason }],
  });
  mount();
  expect(await screen.findByText("Upcoming money cannot be fully determined yet.")).toBeVisible();
  expect(
    screen.queryByText("No unmatched scheduled money in this date range."),
  ).not.toBeInTheDocument();
  expect(screen.getByText(/This list is incomplete/)).toBeVisible();
  expect(screen.getByRole("link", { name: "Open upcoming money" })).toBeVisible();
});

it("reports no unmatched scheduled money only after all source schedules are available", async () => {
  mount();
  expect(await screen.findByText("No unmatched scheduled money in this date range.")).toBeVisible();
  expect(screen.queryByText(/This list is incomplete/)).not.toBeInTheDocument();
  expect(
    screen.queryByText("Upcoming money cannot be fully determined yet."),
  ).not.toBeInTheDocument();
});

vi.spyOn(toast, "error");

it("links compact position metrics to their owning views and explains Spending scope", async () => {
  mount();
  const metrics = await screen.findByRole("region", { name: "Finance key metrics" });
  expect(within(metrics).getByRole("link", { name: /^Cash/ })).toHaveAttribute(
    "href",
    "/finances/accounts",
  );
  expect(within(metrics).getByRole("link", { name: /^Spent this month/ })).toHaveAttribute(
    "href",
    "/finances/spending?period=month&pending=0",
  );
  expect(within(metrics).getByRole("link", { name: /^Net worth/ })).toHaveAttribute(
    "href",
    "/finances/wealth",
  );
  expect(
    within(metrics).getByText(/Posted personal expenses · no pending or transfers/),
  ).toBeVisible();
  expect(screen.getByText(/Its total can differ with account or date filters/)).toBeVisible();
});

it("shows six upcoming items together and paginates larger schedules with standard controls", async () => {
  api.listFinanceRecurringOccurrences.mockResolvedValue({
    occurrences: Array.from({ length: 6 }, (_, i) =>
      occurrence(`Item ${String(i).padStart(2, "0")}`),
    ),
    unavailableSources: [],
  });
  const client = mount();
  const table = await screen.findByRole("table", { name: "Upcoming expected money" });
  await within(table).findByText("Item 05");
  expect(within(table).getAllByRole("row")).toHaveLength(7);
  expect(screen.queryByText(/Next 30 days/)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  api.listFinanceRecurringOccurrences.mockResolvedValue({
    occurrences: Array.from({ length: 12 }, (_, i) =>
      occurrence(`Item ${String(i).padStart(2, "0")}`),
    ),
    unavailableSources: [],
  });
  await client.invalidateQueries({ queryKey: ["finance-recurring-occurrences"] });
  await waitFor(() => expect(screen.getByRole("button", { name: "Next page" })).toBeEnabled());
  expect(within(table).getAllByRole("row")).toHaveLength(11);
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  expect(within(table).getByText("Item 11")).toBeVisible();
  expect(within(table).queryByText("Item 00")).not.toBeInTheDocument();
  expect(screen.getByText("11–12 of 12")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
  expect(within(table).getByText("Item 00")).toBeVisible();
});

it("links upcoming income and outflows to Cash flow and shows signed amounts without currency codes", async () => {
  api.listFinanceRecurringOccurrences.mockResolvedValue({
    occurrences: [
      occurrence("Salary", { source: { kind: "income", id: "salary / one" } }),
      occurrence("Rent", { source: { kind: "obligation", id: "rent / one" } }),
    ],
    unavailableSources: [],
  });
  mount();
  const table = await screen.findByRole("table", { name: "Upcoming expected money" });
  expect(await within(table).findByRole("link", { name: "Salary" })).toHaveAttribute(
    "href",
    "/finances/cashflow?view=income&record=salary%20%2F%20one",
  );
  expect(within(table).getByRole("link", { name: "Rent" })).toHaveAttribute(
    "href",
    "/finances/cashflow?view=subscriptions&record=rent%20%2F%20one",
  );
  expect(within(table).getByText("+$20.00")).toHaveClass("text-success");
  expect(within(table).getByText("−$20.00")).toHaveClass("text-destructive");
  expect(within(table).queryByText("Type")).not.toBeInTheDocument();
  expect(within(table).queryByText(/USD/)).not.toBeInTheDocument();
});
