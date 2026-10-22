// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { ApiClientError } from "@personal-os/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { BalanceBasisFormProps } from "./balance-basis-form.js";
import { FinanceCashflowPlanning } from "./cashflow-planning.js";
import type { OccurrenceMatchDialogProps } from "./occurrence-match-dialog.js";
import type { PaydayViewProps } from "./payday-view.js";
import type { RecurringScheduleFormProps } from "./recurring-schedule-form.js";

const mock = vi.hoisted(() => ({
  api: {
    getMe: vi.fn(),
    listFinanceAccounts: vi.fn(),
    listFinanceCashflowSources: vi.fn(),
    listFinanceRecurringSchedules: vi.fn(),
    listFinanceBalanceBases: vi.fn(),
    getFinanceCashflowProjection: vi.fn(),
    listFinanceBalanceBasisSources: vi.fn(),
  },
  schedule: vi.fn(),
  basis: vi.fn(),
  match: vi.fn(),
}));
vi.mock("../../api.js", () => ({ api: mock.api }));
vi.mock("./recurring-schedule-form.js", () => ({
  RecurringScheduleForm: (props: RecurringScheduleFormProps) => {
    mock.schedule(props);
    return (
      <div role="dialog" aria-label="Schedule statement">
        Revision {props.expectedSourceRevision}
        <button type="button" onClick={props.onClose}>
          Close statement
        </button>
      </div>
    );
  },
}));
vi.mock("./balance-basis-form.js", () => ({
  BalanceBasisForm: (props: BalanceBasisFormProps) => {
    mock.basis(props);
    return (
      <div role="dialog" aria-label="Balance statement">
        Account revision {props.account.accountRevision}
        <button type="button" onClick={props.onClose}>
          Close statement
        </button>
      </div>
    );
  },
}));
vi.mock("./occurrence-match-dialog.js", () => ({
  OccurrenceMatchDialog: (props: OccurrenceMatchDialogProps) => {
    mock.match(props);
    return (
      <div role="dialog" aria-label="Occurrence receipts">
        {props.occurrence.displayName}
        <button type="button" onClick={props.onClose}>
          Close receipts
        </button>
      </div>
    );
  },
}));
vi.mock("./payday-view.js", () => ({
  PaydayView: ({
    onReviewActuals,
    onConfirmSchedule,
    onConfirmBalance,
    onIncomeStreamChange,
    onRefresh,
  }: PaydayViewProps) => (
    <section aria-label="Payday projection">
      Qualified projection read
      <button type="button" onClick={onReviewActuals}>
        Review actual matches
      </button>
      <button type="button" onClick={onConfirmSchedule}>
        Review schedule sources
      </button>
      <button type="button" onClick={onConfirmBalance}>
        Review balance statements
      </button>
      <button type="button" onClick={() => onIncomeStreamChange(income)}>
        Choose payday source
      </button>
      <button type="button" onClick={() => onIncomeStreamChange(null)}>
        Clear payday source
      </button>
      <button type="button" onClick={onRefresh}>
        Refresh planning evidence
      </button>
    </section>
  ),
}));
const owner = "00000000-0000-4000-8000-000000000009";
const account = "00000000-0000-4000-8000-000000000001";
const income = "00000000-0000-4000-8000-000000000002";
const bill = "00000000-0000-4000-8000-000000000003";
const version = "00000000-0000-4000-8000-000000000004";
const transaction = "00000000-0000-4000-8000-000000000007";
const baseRecord = {
  accountId: account,
  confidence: 1,
  payer: "Employer",
  source: "user",
  status: "active",
  cadence: "monthly",
  lastObservedDate: null,
  expectedAmount: 100,
  revision: 2,
};
const currentAccount = {
  id: account,
  name: "Private cash",
  currencyCode: "EUR",
  kind: "cash",
  includeInPlanning: true,
  ownershipType: "individual",
  ownershipShare: 100,
  accountRevision: "9007199254740993",
};
const sources = {
  from: "2026-10-01",
  to: "2026-10-31",
  accounts: [currentAccount],
  income: [
    {
      ...baseRecord,
      id: income,
      displayName: "Private salary",
      merchant: "Employer",
      nextExpectedDate: "2026-10-20",
    },
    {
      ...baseRecord,
      id: "00000000-0000-4000-8000-000000000006",
      displayName: "Undated income",
      merchant: "Other",
      nextExpectedDate: null,
    },
  ],
  obligations: [
    {
      ...baseRecord,
      id: bill,
      displayName: "Private bill",
      merchant: "Bill",
      kind: "bill",
      nextExpectedDate: "2026-10-21",
    },
  ],
  transactions: [
    {
      id: transaction,
      accountId: account,
      merchant: "Prior actual",
      date: "2026-09-01",
      amountCents: 1000,
      currencyCode: "EUR",
      direction: "income",
      pending: false,
      transactionRevision: "9007199254740995",
      reimbursementRelationshipRevision: "9007199254740997",
      incomeEligibility: { eligible: true, reasons: [] },
      allocations: [],
    },
  ],
  coverage: { truncated: false, transactionLimit: 1000 },
};
const schedule = {
  id: version,
  source: { kind: "income", id: income },
  sourceRevision: 2,
  supersedesId: null,
  effectiveFrom: "2026-10-01",
  accountId: account,
  cadence: "monthly",
  timezone: "America/New_York",
  anchorLocalDate: "2026-10-20",
  semimonthlyDays: null,
  amountBasis: "fixed",
  amountCents: 10000,
  currencyCode: "EUR",
  actorUserId: owner,
  recordedAt: "2026-10-18T12:00:00Z",
};
const occurrence = {
  key: "canonical-occurrence-1",
  occurrenceId: "00000000-0000-4000-8000-000000000005",
  scheduleVersionId: version,
  source: { kind: "income", id: income },
  sourceRevision: 2,
  accountId: account,
  displayName: "Private salary",
  localDate: "2026-10-20",
  slot: 0,
  expectedAmountCents: 10000,
  currencyCode: "EUR",
  amountBasis: "fixed",
  certainty: "expected",
  inCurrentSchedule: true,
  matchState: "partially_matched",
  matchedAmountCents: 3000,
  remainingExpectedCents: 7000,
  matchIds: [],
};
const result = {
  schedule: {
    from: "2026-10-01",
    to: "2026-10-31",
    occurrences: [occurrence],
    matchEvents: [],
    unavailableSources: [],
  },
  projection: {
    status: "unavailable",
    reasons: [{ code: "balance_basis_unavailable", evidenceId: null }],
  },
};
function Location() {
  return <output aria-label="Location">{useLocation().search}</output>;
}
function mount(
  url = "/finances/cashflow?cashflowFrom=2026-10-01&cashflowTo=2026-10-31&sentinel=keep",
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  const rendered = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <FinanceCashflowPlanning />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...rendered, client };
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.api.getMe.mockResolvedValue({ id: owner, planningTimezone: "America/New_York" });
  mock.api.listFinanceAccounts.mockResolvedValue({ accounts: [currentAccount] });
  mock.api.listFinanceCashflowSources.mockResolvedValue(structuredClone(sources));
  mock.api.listFinanceRecurringSchedules.mockResolvedValue([structuredClone(schedule)]);
  mock.api.listFinanceBalanceBases.mockResolvedValue([]);
  mock.api.getFinanceCashflowProjection.mockResolvedValue(structuredClone(result));
  mock.api.listFinanceBalanceBasisSources.mockResolvedValue({
    accounts: [currentAccount],
    transactions: sources.transactions,
    coverage: { complete: true, truncated: false, transactionLimit: 1000 },
  });
});
it("uses canonical occurrences once while retaining unconfirmed next dates and undated records", async () => {
  mount();
  const agenda = await screen.findByRole("region", { name: "Upcoming money agenda" });
  expect(await within(agenda).findByRole("link", { name: "Private salary" })).toBeVisible();
  expect(within(agenda).getAllByRole("link", { name: "Private salary" })).toHaveLength(1);
  expect(within(agenda).getByRole("link", { name: "Private bill" })).toBeVisible();
  expect(screen.getByRole("region", { name: "Undated items" })).toHaveTextContent("Undated income");
  expect(screen.getByText(/Matched 30.00 EUR.*Remaining expected 70.00 EUR/)).toBeVisible();
  expect(screen.getAllByText(/schedule unconfirmed/)).toHaveLength(2);
});
it("uses the same dated occurrence in the calendar and preserves unrelated URL state", async () => {
  const user = userEvent.setup();
  mount();
  await screen.findByRole("link", { name: "Private salary" });
  await user.click(screen.getByRole("radio", { name: "Calendar" }));
  await user.click(
    screen.getByRole("button", { name: /October 20, 2026, 1 scheduled occurrence/ }),
  );
  expect(screen.getByRole("link", { name: "Private salary" })).toBeVisible();
  expect(screen.queryByRole("link", { name: "Private bill" })).not.toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Undated items" })).toHaveTextContent("Undated income");
  expect(screen.getByLabelText("Location")).toHaveTextContent("sentinel=keep");
});
it("opens a schedule against current source revision and latest immutable predecessor", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(await screen.findByRole("button", { name: "Revise schedule" }));
  expect(screen.getByRole("dialog", { name: "Schedule statement" })).toHaveTextContent(
    "Revision 2",
  );
  expect(mock.schedule.mock.lastCall?.[0]).toMatchObject({
    source: { kind: "income", id: income },
    expectedSourceRevision: 2,
    supersedes: { id: version },
  });
});
it("reads complete balance history through the dedicated account-scoped current-revision seam", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(await screen.findByRole("button", { name: "Review balance for Private cash" }));
  expect(await screen.findByRole("dialog", { name: "Balance statement" })).toHaveTextContent(
    "9007199254740993",
  );
  expect(mock.api.listFinanceBalanceBasisSources).toHaveBeenCalledWith({ accountIds: [account] });
  expect(mock.basis.mock.lastCall?.[0]).toMatchObject({
    transactions: [
      { id: transaction, date: "2026-09-01", transactionRevision: "9007199254740995" },
    ],
    coverage: { complete: true, truncated: false },
  });
});
it("passes canonical candidates and immutable match events to occurrence inspection", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(await screen.findByRole("button", { name: "Match or inspect receipts" }));
  expect(screen.getByRole("dialog", { name: "Occurrence receipts" })).toBeVisible();
  expect(mock.match.mock.lastCall?.[0]).toMatchObject({
    occurrence: { key: occurrence.key },
    candidates: [
      {
        id: transaction,
        transactionRevision: "9007199254740995",
        reimbursementRelationshipRevision: "9007199254740997",
        incomeEligibility: { eligible: true },
      },
    ],
    matchEvents: [],
  });
});
it.each([
  "sources",
  "me",
])("hides cached private material and dismisses dialogs after same-owner %s 403", async (kind) => {
  const user = userEvent.setup();
  const { client, unmount } = mount();
  await user.click(await screen.findByRole("button", { name: "Revise schedule" }));
  expect(screen.getByRole("dialog")).toBeVisible();
  const fn = kind === "sources" ? mock.api.listFinanceCashflowSources : mock.api.getMe;
  fn.mockRejectedValue(new ApiClientError({ status: 403, code: "forbidden", message: "Denied" }));
  await act(async () => {
    await client.invalidateQueries({
      queryKey: [kind === "sources" ? "finance-cashflow-sources" : "me"],
    });
  });
  expect(await screen.findByText(/Cash flow planning access unavailable/)).toBeVisible();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Private salary" })).not.toBeInTheDocument();
  fn.mockResolvedValue(
    kind === "sources"
      ? structuredClone(sources)
      : { id: owner, planningTimezone: "America/New_York" },
  );
  await act(async () => {
    await client.invalidateQueries({
      queryKey: [kind === "sources" ? "finance-cashflow-sources" : "me"],
    });
  });
  if (kind === "sources") {
    expect(screen.getByText(/Cash flow planning access unavailable/)).toBeVisible();
    expect(screen.queryByRole("link", { name: "Private salary" })).not.toBeInTheDocument();
    unmount();
    mount();
  }
  expect(await screen.findByRole("link", { name: "Private salary" })).toBeVisible();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("retains cached material and opening state on a transient source failure", async () => {
  const user = userEvent.setup();
  const { client } = mount();
  await user.click(await screen.findByRole("button", { name: "Revise schedule" }));
  mock.api.listFinanceCashflowSources.mockRejectedValue(
    new ApiClientError({ status: 503, code: "unavailable", message: "Temporary" }),
  );
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["finance-cashflow-sources"] });
  });
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(screen.getByRole("link", { name: "Private salary" })).toBeVisible();
});
it("rejects an invalid date window without reading a fabricated range and resets only its filters", async () => {
  const user = userEvent.setup();
  mount("/finances/cashflow?cashflowFrom=2026-10-31&cashflowTo=2026-10-01&sentinel=keep");
  expect(await screen.findByText(/Choose a valid date range/)).toBeVisible();
  expect(mock.api.listFinanceCashflowSources).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Timeline options" }));
  await user.click(screen.getByRole("button", { name: "Reset timeline filters" }));
  await screen.findByRole("link", { name: "Private salary" });
  expect(screen.getByLabelText("Location")).toHaveTextContent("sentinel=keep");
});
it("keeps no selected accounts distinct from following all accounts", async () => {
  mount("/finances/cashflow?cashflowFrom=2026-10-01&cashflowTo=2026-10-31&cashflowAccounts=none");
  await screen.findByRole("link", { name: "Private salary" });
  expect(mock.api.listFinanceCashflowSources).toHaveBeenCalledWith(
    expect.objectContaining({ accountIds: [] }),
  );
  expect(mock.api.getFinanceCashflowProjection).toHaveBeenCalledWith(
    expect.objectContaining({ accountIds: [] }),
  );
});
it("never carries an opening statement across a valid authenticated-owner change", async () => {
  const user = userEvent.setup();
  const { client } = mount();
  await user.click(await screen.findByRole("button", { name: "Revise schedule" }));
  expect(screen.getByRole("dialog")).toBeVisible();
  const pending = new Promise(() => {});
  mock.api.listFinanceCashflowSources.mockReturnValue(pending);
  mock.api.listFinanceRecurringSchedules.mockReturnValue(pending);
  mock.api.listFinanceBalanceBases.mockReturnValue(pending);
  mock.api.listFinanceAccounts.mockReturnValue(pending);
  mock.api.getFinanceCashflowProjection.mockReturnValue(pending);
  mock.api.getMe.mockResolvedValue({
    id: "00000000-0000-4000-8000-000000000099",
    planningTimezone: "America/New_York",
  });
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["me"] });
  });
  await waitFor(() =>
    expect(screen.queryByRole("link", { name: "Private salary" })).not.toBeInTheDocument(),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("does not invent a next-date fallback when a confirmed schedule has no occurrence in the range", async () => {
  mock.api.getFinanceCashflowProjection.mockResolvedValue({
    ...structuredClone(result),
    schedule: { ...structuredClone(result.schedule), occurrences: [] },
  });
  mount();
  await screen.findByRole("button", { name: "Private salary" });
  expect(screen.queryByRole("link", { name: "Private salary" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Private bill" })).toBeVisible();
});
it("keeps all occurrence rows reachable through bounded agenda pages", async () => {
  const user = userEvent.setup();
  mock.api.getFinanceCashflowProjection.mockResolvedValue({
    ...structuredClone(result),
    schedule: {
      ...structuredClone(result.schedule),
      occurrences: Array.from({ length: 51 }, (_, index) => ({
        ...occurrence,
        key: `occurrence-${String(index).padStart(3, "0")}`,
        displayName: `Scheduled payment ${index + 1}`,
      })),
    },
  });
  mount();
  await screen.findByRole("link", { name: "Scheduled payment 1" });
  expect(screen.queryByRole("link", { name: "Scheduled payment 51" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Next items" }));
  expect(screen.getByRole("link", { name: "Scheduled payment 51" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Previous items" }));
  expect(screen.getByRole("link", { name: "Scheduled payment 1" })).toBeVisible();
});

it("takes actual-match review to money movements with canonical transaction navigation", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(await screen.findByRole("button", { name: "Review actual matches" }));
  expect(screen.getByRole("region", { name: "Actual money movements" })).toHaveFocus();
  expect(screen.getByRole("link", { name: "Review transactions" })).toHaveAttribute(
    "href",
    "/finances/transactions",
  );
});

it("discloses capped source coverage instead of presenting partial counts as complete", async () => {
  mock.api.listFinanceCashflowSources.mockResolvedValue({
    ...structuredClone(sources),
    coverage: { ...sources.coverage, truncated: true },
  });
  mount();
  expect(await screen.findByText(/This source read reached its limit/)).toHaveTextContent(
    "agenda, calendar and counts show a partial set",
  );
  expect(screen.getByText(/This source read reached its limit/)).toHaveTextContent(
    "narrow the date range or account selection",
  );
});

it("requires an authenticated planning timezone before requesting private Finance material", async () => {
  mock.api.getMe.mockResolvedValue({ id: owner, planningTimezone: null });
  mount();
  expect(await screen.findByText("Planning timezone unavailable.")).toBeVisible();
  expect(mock.api.listFinanceCashflowSources).not.toHaveBeenCalled();
  expect(mock.api.listFinanceAccounts).not.toHaveBeenCalled();
});

it("recovers from an initial identity failure without querying private sources prematurely", async () => {
  mock.api.getMe.mockRejectedValueOnce(new Error("Identity temporarily unavailable"));
  const user = userEvent.setup();
  mount();
  await screen.findByRole("button", { name: "Try again" });
  expect(mock.api.listFinanceCashflowSources).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("link", { name: "Private salary" })).toBeVisible();
});

it.each([
  "listFinanceCashflowSources",
  "listFinanceRecurringSchedules",
  "listFinanceBalanceBases",
  "listFinanceAccounts",
  "getFinanceCashflowProjection",
] as const)("lets a failed %s read recover through its actual retry control", async (method) => {
  mock.api[method].mockRejectedValueOnce(new Error("Temporary read failure"));
  const user = userEvent.setup();
  mount();
  await user.click(await screen.findByRole("button", { name: "Try again" }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument(),
  );
  expect(mock.api[method]).toHaveBeenCalledTimes(2);
  expect(await screen.findByRole("link", { name: "Private salary" })).toBeVisible();
});

it.each([
  "listFinanceCashflowSources",
  "listFinanceRecurringSchedules",
  "listFinanceBalanceBases",
  "listFinanceAccounts",
  "getFinanceCashflowProjection",
  "listFinanceBalanceBasisSources",
] as const)("hides private snapshots after %s loses authorization", async (method) => {
  const user = userEvent.setup();
  const { client } = mount();
  await screen.findByRole("link", { name: "Private salary" });
  mock.api[method].mockRejectedValue(
    new ApiClientError({ status: 401, code: "unauthorized", message: "Expired" }),
  );
  if (method === "listFinanceBalanceBasisSources") {
    await user.click(screen.getByRole("button", { name: "Review balance for Private cash" }));
  } else {
    await act(async () => {
      await client.invalidateQueries({
        predicate: (query) => String(query.queryKey[0]).startsWith("finance-"),
      });
    });
  }
  expect(await screen.findByText(/Cash flow planning access unavailable/)).toBeVisible();
  expect(screen.queryByRole("link", { name: "Private salary" })).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("retries a failed balance-history read, scopes its movements and closes the opening statement", async () => {
  const user = userEvent.setup();
  mock.api.listFinanceBalanceBasisSources.mockRejectedValueOnce(new Error("Review unavailable"));
  mount();
  await user.click(await screen.findByRole("button", { name: "Review balance for Private cash" }));
  await user.click(await screen.findByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("dialog", { name: "Balance statement" })).toBeVisible();
  expect(mock.basis.mock.lastCall?.[0].previousBasis).toBeNull();
  await user.click(screen.getByRole("button", { name: "Close statement" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("keeps retained history and later schedule sources reachable without duplicating them in the current agenda", async () => {
  const user = userEvent.setup();
  mock.api.getFinanceCashflowProjection.mockResolvedValue({
    ...structuredClone(result),
    schedule: {
      ...structuredClone(result.schedule),
      occurrences: [
        occurrence,
        ...Array.from({ length: 51 }, (_, index) => ({
          ...occurrence,
          key: `history-${index}`,
          displayName: `Old salary ${index + 1}`,
          inCurrentSchedule: false,
        })),
      ],
    },
  });
  mock.api.listFinanceCashflowSources.mockResolvedValue({
    ...structuredClone(sources),
    income: Array.from({ length: 21 }, (_, index) => ({
      ...sources.income[0],
      id: index === 0 ? income : `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
      displayName: `Source ${index + 1}`,
    })),
  });
  mount();
  const history = await screen.findByRole("region", { name: "Retained occurrence history" });
  expect(within(history).queryByRole("link", { name: /Old salary 51/ })).not.toBeInTheDocument();
  await user.click(within(history).getByRole("button", { name: "Show more occurrence history" }));
  expect(within(history).getByRole("link", { name: /Old salary 51/ })).toBeVisible();
  const sourcesRegion = screen.getByRole("region", { name: "Recurring schedule sources" });
  expect(
    within(sourcesRegion).queryByRole("button", { name: "Source 21" }),
  ).not.toBeInTheDocument();
  await user.click(
    within(sourcesRegion).getByRole("button", { name: "Show more schedule sources" }),
  );
  await user.click(within(sourcesRegion).getByRole("button", { name: "Source 21" }));
  expect(mock.schedule.mock.lastCall?.[0]).toMatchObject({
    source: { kind: "income", id: "00000000-0000-4000-8000-000000000120" },
    supersedes: null,
  });
});

it("focuses recovery destinations and changes only explicit payday selection before refreshing evidence", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(await screen.findByRole("button", { name: "Review schedule sources" }));
  expect(screen.getByRole("region", { name: "Recurring schedule sources" })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Review balance statements" }));
  expect(screen.getByRole("region", { name: "Balance statements" })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Choose payday source" }));
  expect(screen.getByLabelText("Location")).toHaveTextContent(`paydayIncome=${income}`);
  await user.click(screen.getByRole("button", { name: "Clear payday source" }));
  expect(screen.getByLabelText("Location")).not.toHaveTextContent("paydayIncome");
  expect(screen.getByLabelText("Location")).toHaveTextContent("sentinel=keep");
  const reads = mock.api.listFinanceRecurringSchedules.mock.calls.length;
  await user.click(screen.getByRole("button", { name: "Refresh planning evidence" }));
  await waitFor(() =>
    expect(mock.api.listFinanceRecurringSchedules.mock.calls.length).toBeGreaterThan(reads),
  );
});

it("discards a latched denial only when the authenticated owner remounts, without restoring the previous owner's facts", async () => {
  const user = userEvent.setup();
  const { client } = mount();
  mock.api.listFinanceBalanceBasisSources.mockRejectedValue(
    new ApiClientError({ status: 401, code: "unauthorized", message: "Expired" }),
  );
  await user.click(await screen.findByRole("button", { name: "Review balance for Private cash" }));
  expect(await screen.findByText(/Cash flow planning access unavailable/)).toBeVisible();
  mock.api.getMe.mockResolvedValue({
    id: "00000000-0000-4000-8000-000000000099",
    planningTimezone: "America/New_York",
  });
  mock.api.listFinanceCashflowSources.mockResolvedValue({
    ...structuredClone(sources),
    accounts: [],
    income: [],
    obligations: [],
    transactions: [],
  });
  mock.api.listFinanceAccounts.mockResolvedValue({ accounts: [] });
  mock.api.listFinanceRecurringSchedules.mockResolvedValue([]);
  mock.api.getFinanceCashflowProjection.mockResolvedValue({
    ...structuredClone(result),
    schedule: { ...structuredClone(result.schedule), occurrences: [] },
  });
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["me"] });
  });
  expect(
    await screen.findByText("No next expected items recorded in this date range."),
  ).toBeVisible();
  expect(screen.queryByText(/Cash flow planning access unavailable/)).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Private salary" })).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
