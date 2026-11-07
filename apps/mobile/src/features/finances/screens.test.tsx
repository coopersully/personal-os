// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import type { PropsWithChildren, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FinanceAccountsScreen } from "./accounts";
import { FinanceAssistantScreen } from "./assistant";
import { FinanceOverviewScreen } from "./overview";
import { FinancePlanScreen } from "./plan";
import { FinanceSpendingScreen } from "./spending";
import { FinanceTransactionEditor } from "./transaction-editor";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("@tanstack/react-query", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/apps/web/package.json`)("@tanstack/react-query");
});
const h = vi.hoisted(() => ({
  keyboardListeners: new Map<string, (event?: { endCoordinates: { screenY: number } }) => void>(),
  focus: undefined as undefined | (() => (() => void) | undefined),
  foreground: undefined as undefined | ((state: string) => void),
  removeListener: vi.fn(),
  owner: "owner-a",
  params: { id: "transaction-1" } as Record<string, string>,
  push: vi.fn(),
  navigate: vi.fn(),
  setParams: vi.fn(),
  back: vi.fn(),
  alert: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  dismiss: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(() => "save"),
  api: {
    listFinanceAccounts: vi.fn(),
    getFinanceSpending: vi.fn(),
    listFinanceActivity: vi.fn(),
    listFinanceTransactions: vi.fn(),
    listFinanceSpendingTransactions: vi.fn(),
    getFinanceBudget: vi.fn(),
    listFinanceGoals: vi.fn(),
    listFinanceRecurringOccurrences: vi.fn(),
    getFinanceReviewQueue: vi.fn(),
    getFinanceConversationHistory: vi.fn(),
    getFinanceTransaction: vi.fn(),
    getFinanceCategories: vi.fn(),
    updateFinanceTransaction: vi.fn(),
  },
}));
vi.mock("react-native", () => {
  const Box = ({ children }: PropsWithChildren) => <div>{children}</div>;
  return {
    AppState: {
      addEventListener: (_event: string, callback: (state: string) => void) => {
        h.foreground = callback;
        return { remove: h.removeListener };
      },
    },
    Keyboard: {
      addListener: (
        name: string,
        callback: (event?: { endCoordinates: { screenY: number } }) => void,
      ) => {
        h.keyboardListeners.set(name, callback);
        return { remove: () => h.keyboardListeners.delete(name) };
      },
    },
    useWindowDimensions: () => ({ height: 852, width: 393 }),
    View: Box,
    ScrollView: Box,
    Modal: Box,
    Text: Box,
    KeyboardAvoidingView: Box,
    ActivityIndicator: () => <span>Loading</span>,
    Alert: { alert: h.alert },
    Platform: { OS: "web" },
    useColorScheme: () => "light",
    Pressable: ({
      children,
      onPress,
      disabled,
      accessibilityLabel,
      accessibilityState,
    }: PropsWithChildren<{
      onPress?: () => void;
      disabled?: boolean;
      accessibilityLabel?: string;
      accessibilityState?: { selected?: boolean };
    }>) => (
      <button
        type="button"
        aria-label={accessibilityLabel}
        aria-pressed={accessibilityState?.selected}
        disabled={disabled}
        onClick={onPress}
      >
        {children}
      </button>
    ),
    TextInput: ({
      accessibilityLabel,
      value,
      onChangeText,
      placeholder,
      editable = true,
    }: {
      accessibilityLabel?: string;
      value: string;
      onChangeText: (v: string) => void;
      placeholder?: string;
      editable?: boolean;
    }) => (
      <input
        aria-label={accessibilityLabel}
        disabled={!editable}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChangeText(e.target.value)}
      />
    ),
  };
});
vi.mock("../../components/screen", () => ({
  Screen: ({ children }: PropsWithChildren) => <main>{children}</main>,
}));
vi.mock("../../components/icons", () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));
vi.mock("../../components/glass-surface", () => ({
  GlassSurface: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("../auth/context", () => ({
  useAuth: () => ({
    state: { user: { id: h.owner, planningTimezone: "America/New_York" } },
    session: { api: () => h.api },
  }),
}));
vi.mock("sonner-native", () => ({ toast: h }));
vi.mock("../../components/app-toaster", () => ({
  AppToaster: () => <div data-testid="editor-feedback" />,
}));
vi.mock("expo-router", () => ({
  router: h,
  useLocalSearchParams: () => h.params,
  useFocusEffect: (callback: () => (() => void) | undefined) => {
    h.focus = callback;
  },
  Stack: {
    Screen: ({ options }: { options: { headerLeft?: () => ReactNode } }) =>
      options.headerLeft?.() ?? null,
  },
}));
const account = {
  id: "account-1",
  name: "Everyday checking",
  institution: "Example bank",
  currencyCode: "USD",
  balance: 2400,
  includeInPlanning: true,
  kind: "cash",
  status: "manual",
  accountMask: null,
  lastSyncedAt: null,
};
const transaction = {
  id: "transaction-1",
  merchant: "Corner market",
  amount: 42,
  currencyCode: "USD",
  direction: "expense",
  date: "2026-11-07",
  category: "Groceries",
  notes: null,
  accountId: account.id,
  updatedAt: "2026-11-07T12:00:00Z",
};
const revision = "a".repeat(64);
const spending = {
  referenceRevision: revision,
  snapshot: { netCents: 4200, coverage: "partial", bins: [] },
  currency: { unsupported: [] },
  source: { freshness: "stale" },
  groups: [{ id: "groceries", label: "Groceries", netCents: 4200 }],
};
function mount(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  return { ...view, client };
}
beforeEach(() => {
  vi.clearAllMocks();
  h.owner = "owner-a";
  h.params = { id: "transaction-1" };
  h.api.listFinanceAccounts.mockResolvedValue({
    accounts: [account],
    totals: { cash: 2400, netWorth: 2400, debt: 0, investments: 0, otherAssets: 0 },
    accountSemantics: { trustworthy: true },
  });
  h.api.getFinanceSpending.mockResolvedValue(spending);
  h.api.listFinanceActivity.mockResolvedValue({ entries: [], nextCursor: null });
  h.api.listFinanceTransactions.mockResolvedValue({ items: [transaction], nextCursor: null });
  h.api.listFinanceSpendingTransactions.mockResolvedValue({
    items: [transaction],
    nextCursor: null,
  });
  h.api.getFinanceBudget.mockResolvedValue({ data: null });
  h.api.listFinanceGoals.mockResolvedValue({ data: [] });
  h.api.listFinanceRecurringOccurrences.mockResolvedValue({
    occurrences: [],
    unavailableSources: [],
  });
  h.api.getFinanceReviewQueue.mockResolvedValue([]);
  h.api.getFinanceConversationHistory.mockResolvedValue({ messages: [], nextCursor: null });
  h.api.getFinanceTransaction.mockResolvedValue({ data: transaction });
  h.api.getFinanceCategories.mockResolvedValue([
    { id: "category", name: "Groceries" },
    { id: "travel", name: "Travel" },
  ]);
  h.api.updateFinanceTransaction.mockResolvedValue(transaction);
});
afterEach(cleanup);
it("shows real amounts and source qualifications without a duplicate review read", async () => {
  mount(<FinanceOverviewScreen />);
  expect(await screen.findByText("42.00")).toBeTruthy();
  expect(screen.getByText(/partial coverage/)).toBeTruthy();
  expect(h.api.getFinanceReviewQueue).not.toHaveBeenCalled();
});
it("keeps mixed currency totals out of overview", async () => {
  h.api.listFinanceAccounts.mockResolvedValue({
    accounts: [account, { ...account, id: "eur", currencyCode: "EUR" }],
    totals: { cash: 9999, netWorth: 9999 },
    accountSemantics: { trustworthy: false },
  });
  mount(<FinanceOverviewScreen />);
  expect((await screen.findAllByText("View by account")).length).toBe(2);
  expect(screen.queryByText(/9,999/)).toBeNull();
});
it("searches accounts and opens the selected canonical identity", async () => {
  mount(<FinanceAccountsScreen />);
  fireEvent.click(await screen.findByRole("button", { name: /Everyday checking/ }));
  expect(h.push).toHaveBeenCalledWith({ pathname: "/finance-account", params: { id: account.id } });
  fireEvent.change(screen.getByLabelText("Search accounts"), { target: { value: "missing" } });
  expect(screen.getByText("No matching accounts.")).toBeTruthy();
});
it("preserves the exact spending reference for category drill-down", async () => {
  mount(<FinanceSpendingScreen />);
  fireEvent.click(await screen.findByRole("button", { name: /Groceries/ }));
  await screen.findByText("Corner market");
  expect(h.api.listFinanceSpendingTransactions).toHaveBeenCalledWith(
    expect.objectContaining({
      referenceRevision: revision,
      groupId: "groceries",
      query: expect.objectContaining({
        grouping: "auto",
        scope: expect.objectContaining({ basis: "personal_cost", timezone: "America/New_York" }),
      }),
    }),
    undefined,
  );
});
it("loads subsequent transaction pages only on request", async () => {
  h.api.listFinanceTransactions
    .mockResolvedValueOnce({ items: [transaction], nextCursor: "page-2" })
    .mockResolvedValueOnce({
      items: [{ ...transaction, id: "next", merchant: "Bookshop" }],
      nextCursor: null,
    });
  mount(<FinanceSpendingScreen />);
  fireEvent.click(screen.getByRole("button", { name: "Transactions" }));
  fireEvent.click(await screen.findByRole("button", { name: /Load more transactions/ }));
  expect(await screen.findByText("Bookshop")).toBeTruthy();
  expect(h.api.listFinanceTransactions).toHaveBeenLastCalledWith(
    expect.objectContaining({ cursor: "page-2" }),
  );
});
it("uses canonical budget, cash flow and wealth reads", async () => {
  mount(<FinancePlanScreen />);
  await screen.findByText("No budget proposal yet.");
  fireEvent.click(screen.getByRole("button", { name: "Cash flow" }));
  await screen.findByText("No scheduled income or bills in the next 30 days.");
  fireEvent.click(screen.getByRole("button", { name: "Wealth" }));
  await screen.findByText("No goals yet.");
});
it("shows the existing conversation and recorded activity without creating new records", async () => {
  mount(<FinanceAssistantScreen />);
  await screen.findByText("No transaction reviews waiting.");
  fireEvent.click(screen.getByRole("button", { name: "Conversation" }));
  await screen.findByText("Your Finance conversation will appear here.");
  fireEvent.click(screen.getByRole("button", { name: "Activity" }));
  await screen.findByText("No recorded activity yet.");
});
it("saves explicit edits with the original revision and only reports confirmed saves", async () => {
  mount(<FinanceTransactionEditor />);
  await screen.findByLabelText("Notes");
  expect(screen.getByLabelText("Save changes")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Dinner with Maya." } });
  expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  fireEvent.click(screen.getByLabelText("Save changes"));
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Transaction updated", { id: "save" }),
  );
  expect(h.api.updateFinanceTransaction).toHaveBeenCalledWith(transaction.id, {
    notes: "Dinner with Maya.",
    expectedTransactionUpdatedAt: transaction.updatedAt,
  });
  expect(screen.queryByText("Transaction updated")).toBeNull();
});
it("does not call a proposed update saved", async () => {
  h.api.updateFinanceTransaction.mockResolvedValue({ status: "pending_review", review: {} });
  mount(<FinanceTransactionEditor />);
  fireEvent.change(await screen.findByLabelText("Notes"), { target: { value: "Review this" } });
  fireEvent.click(screen.getByLabelText("Save changes"));
  await waitFor(() => expect(h.info).toHaveBeenCalled());
  expect(h.success).not.toHaveBeenCalled();
  expect(h.back).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Save changes")).toBeDisabled();
});
it("retains the draft and reports an uncertain save through Sonner", async () => {
  h.api.updateFinanceTransaction.mockRejectedValue(new Error("offline"));
  mount(<FinanceTransactionEditor />);
  fireEvent.change(await screen.findByLabelText("Notes"), { target: { value: "Keep my draft" } });
  fireEvent.click(screen.getByLabelText("Save changes"));
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(screen.getByLabelText("Notes")).toHaveValue("Keep my draft");
  expect(screen.queryByText(/Couldn’t confirm the save/)).toBeNull();
});

it("does not navigate or announce a late save after leaving the editor", async () => {
  let resolve!: (value: typeof transaction) => void;
  h.api.updateFinanceTransaction.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const view = mount(<FinanceTransactionEditor />);
  fireEvent.change(await screen.findByLabelText("Notes"), { target: { value: "Later" } });
  fireEvent.click(screen.getByLabelText("Save changes"));
  view.unmount();
  resolve(transaction);
  await waitFor(() => expect(h.dismiss).toHaveBeenCalledWith("save"));
  expect(h.back).not.toHaveBeenCalled();
  expect(h.success).not.toHaveBeenCalled();
});
it("keeps each signed-in owner's read cache separate", async () => {
  const view = mount(<FinanceAccountsScreen />);
  await screen.findByText("Everyday checking");
  h.owner = "owner-b";
  h.api.listFinanceAccounts.mockResolvedValue({ accounts: [] });
  view.rerender(
    <QueryClientProvider client={view.client}>
      <FinanceAccountsScreen />
    </QueryClientProvider>,
  );
  await screen.findByText("No accounts yet. Connected and manual accounts will appear here.");
  expect(screen.queryByText("Everyday checking")).toBeNull();
  expect(h.api.listFinanceAccounts).toHaveBeenCalledTimes(2);
});
it("retries failed reads instead of inventing an empty financial state", async () => {
  h.api.listFinanceAccounts.mockRejectedValueOnce(new Error("offline"));
  mount(<FinanceAccountsScreen />);
  fireEvent.click(await screen.findByRole("button", { name: /Retry loading/ }));
  await screen.findByText("Everyday checking");
});

it("does not present an unknown included account balance as zero cash", async () => {
  h.api.listFinanceAccounts.mockResolvedValue({
    accounts: [{ ...account, balance: null }],
    totals: { cash: 0, netWorth: 0 },
    accountSemantics: { trustworthy: true },
  });
  mount(<FinanceOverviewScreen />);
  expect((await screen.findAllByText("View by account")).length).toBe(2);
  expect(screen.queryByText("0.00")).toBeNull();
});

it("labels the scoped spending contribution separately from full transaction amounts", async () => {
  h.api.listFinanceSpendingTransactions.mockResolvedValue({
    items: [{ ...transaction, amount: 100 }],
    netCents: 2000,
    nextCursor: null,
  });
  mount(<FinanceSpendingScreen />);
  fireEvent.click(await screen.findByRole("button", { name: /Groceries/ }));
  await screen.findByText("Spending contribution: USD 20.00");
  expect(screen.getByText("Transaction amounts below show the full records.")).toBeTruthy();
});

it("locks draft controls while a save is in flight", async () => {
  let resolve!: (value: typeof transaction) => void;
  h.api.updateFinanceTransaction.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  mount(<FinanceTransactionEditor />);
  fireEvent.change(await screen.findByLabelText("Notes"), { target: { value: "Saved version" } });
  fireEvent.click(screen.getByLabelText("Save changes"));
  expect(screen.getByLabelText("Notes")).toBeDisabled();
  expect(screen.queryByRole("button", { name: /Category/ })).toBeNull();
  resolve(transaction);
  await waitFor(() => expect(h.success).toHaveBeenCalled());
});
it("searches categories in a dismissible entity sheet with a no-match state", async () => {
  mount(<FinanceTransactionEditor />);
  fireEvent.click(await screen.findByRole("button", { name: /Category/ }));
  fireEvent.change(screen.getByLabelText("Search categories"), { target: { value: "missing" } });
  expect(screen.getByText("No matching categories.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Search categories"), { target: { value: "trav" } });
  fireEvent.click(screen.getByRole("button", { name: "Travel" }));
  expect(screen.queryByLabelText("Search categories")).toBeNull();
  expect(screen.getByText("Travel")).toBeTruthy();
  expect(screen.getByLabelText("Save changes")).not.toBeDisabled();
});
it("synchronizes manual Plan selection so the same Overview shortcut can be reused", async () => {
  h.params = { view: "Wealth" };
  const view = mount(<FinancePlanScreen />);
  await screen.findByText("No goals yet.");
  fireEvent.click(screen.getByRole("button", { name: "Budget" }));
  expect(h.setParams).toHaveBeenCalledWith({ view: "Budget" });
  h.params = { view: "Budget" };
  view.rerender(
    <QueryClientProvider client={view.client}>
      <FinancePlanScreen />
    </QueryClientProvider>,
  );
  await screen.findByText("No budget proposal yet.");
  h.params = { view: "Wealth" };
  view.rerender(
    <QueryClientProvider client={view.client}>
      <FinancePlanScreen />
    </QueryClientProvider>,
  );
  await screen.findByText("No goals yet.");
});

it("opens an account with only its scoped transactions and preserves missing balance state", async () => {
  const { FinanceAccountScreen } = await import("./details");
  h.params = { id: account.id };
  h.api.listFinanceAccounts.mockResolvedValue({
    accounts: [
      {
        ...account,
        balance: null,
        ownershipType: "individual",
        provider: "manual",
        lastSyncedAt: null,
      },
    ],
    totals: {},
    accountSemantics: {},
  });
  mount(<FinanceAccountScreen />);
  await screen.findByText("Unavailable");
  await screen.findByText("Corner market");
  expect(h.api.listFinanceTransactions).toHaveBeenCalledWith(
    expect.objectContaining({ accountId: account.id }),
  );
});
it("shows transaction notes, splits, and provenance without inventing a currency", async () => {
  const { FinanceTransactionScreen } = await import("./details");
  h.api.getFinanceTransaction.mockResolvedValue({
    data: {
      ...transaction,
      currencyCode: null,
      pending: true,
      notes: "Shared lunch",
      categoryRationale: "Confirmed by owner",
      allocations: [{ id: "split", treatment: "personal", state: "active", amount: 20 }],
    },
  });
  mount(<FinanceTransactionScreen />);
  await screen.findByText("Shared lunch");
  expect(screen.getByText("Pending · Currency unknown")).toBeTruthy();
  expect(screen.getByText("Confirmed by owner")).toBeTruthy();
  expect(screen.getByText("personal")).toBeTruthy();
});
it("shows unavailable details rather than dereferencing deleted records", async () => {
  const { FinanceTransactionScreen } = await import("./details");
  h.api.getFinanceTransaction.mockResolvedValue({ data: null });
  mount(<FinanceTransactionScreen />);
  await screen.findByText("This transaction is unavailable.");
});
it("distinguishes a proposal from an approved budget and retains assumptions/resources", async () => {
  h.api.getFinanceBudget.mockResolvedValue({
    data: {
      allocatedTotal: 500,
      effectiveFrom: "2026-11",
      status: "proposed",
      version: 2,
      rationale: "Save before discretionary spending",
      allocations: [{ key: "food", amount: 500, kind: "spending", description: "Food" }],
      resources: [
        { key: "pay", inCurrentSchedule: true, description: "Salary", amount: 500, kind: "income" },
      ],
      assumptions: ["Income remains stable"],
    },
  });
  mount(<FinancePlanScreen />);
  await screen.findByText("Proposal — not approved · revision 2");
  expect(screen.getByText("Salary")).toBeTruthy();
  expect(screen.getByText("Income remains stable")).toBeTruthy();
});
it("keeps expected bill and income signs and reports unconfirmed source schedules", async () => {
  h.params = { view: "Cash flow" };
  h.api.listFinanceRecurringOccurrences.mockResolvedValue({
    occurrences: [
      {
        key: "rent",
        inCurrentSchedule: true,
        displayName: "Rent",
        localDate: "2026-11-10",
        source: { kind: "obligation" },
        remainingExpectedCents: 50000,
        currencyCode: "USD",
        matchState: "expected",
      },
      {
        key: "pay",
        inCurrentSchedule: true,
        displayName: "Payroll",
        localDate: "2026-11-12",
        source: { kind: "income" },
        remainingExpectedCents: null,
        currencyCode: "USD",
        matchState: "expected",
      },
    ],
    unavailableSources: [{ reason: "unknown_amount" }],
  });
  mount(<FinancePlanScreen />);
  await screen.findByText(/−USD\s500.00/);
  expect(screen.getByText("Unavailable")).toBeTruthy();
  expect(screen.getByText(/1 sources need schedule confirmation/)).toBeTruthy();
});
it("shows goals and suppresses untrustworthy wealth aggregates", async () => {
  h.params = { view: "Wealth" };
  h.api.listFinanceAccounts.mockResolvedValue({
    accounts: [account],
    totals: { netWorth: 999999 },
    accountSemantics: { trustworthy: false },
  });
  h.api.listFinanceGoals.mockResolvedValue({ data: [{ id: "goal", name: "Emergency fund" }] });
  mount(<FinancePlanScreen />);
  await screen.findByText("Emergency fund");
  expect(screen.getByText("View balances by account")).toBeTruthy();
  expect(screen.queryByText(/999,999/)).toBeNull();
});
it("opens a review's canonical transaction instead of creating a second decision", async () => {
  h.api.getFinanceReviewQueue.mockResolvedValue([
    { id: "review", rationale: null, reason: "unknown_merchant", transaction },
  ]);
  mount(<FinanceAssistantScreen />);
  fireEvent.click(await screen.findByRole("button", { name: /Corner market/ }));
  expect(h.push).toHaveBeenCalledWith({
    pathname: "/finance-transaction",
    params: { id: transaction.id },
  });
});
it("paginates recorded activity with its authoritative cursor", async () => {
  h.params = { view: "Activity" };
  h.api.listFinanceActivity
    .mockResolvedValueOnce({
      entries: [
        {
          id: "a",
          action: "Categorized transaction",
          explanation: "Owner confirmed the category",
          status: "applied",
        },
      ],
      nextCursor: "next",
    })
    .mockResolvedValueOnce({
      entries: [
        {
          id: "b",
          action: "Recorded goal progress",
          explanation: "Statement reviewed",
          status: "applied",
        },
      ],
      nextCursor: null,
    });
  mount(<FinanceAssistantScreen />);
  fireEvent.click(await screen.findByRole("button", { name: /Load more activity/ }));
  await screen.findByText("Recorded goal progress");
  expect(h.api.listFinanceActivity).toHaveBeenLastCalledWith({ cursor: "next", limit: 25 });
});
it("reads user and agent messages from the same ongoing conversation", async () => {
  h.params = { view: "Conversation" };
  h.api.getFinanceConversationHistory
    .mockResolvedValueOnce({
      messages: [
        {
          id: "m1",
          authorKind: "user",
          text: "Review spending",
          createdAt: "2026-11-07T12:00:00Z",
        },
      ],
      nextCursor: "12",
    })
    .mockResolvedValueOnce({
      messages: [
        {
          id: "m2",
          authorKind: "agent",
          text: "Here are the recorded changes",
          createdAt: "2026-11-07T12:00:00Z",
        },
      ],
      nextCursor: null,
    });
  mount(<FinanceAssistantScreen />);
  fireEvent.click(await screen.findByRole("button", { name: /Load more messages/ }));
  await screen.findByText("Here are the recorded changes");
  expect(h.api.getFinanceConversationHistory).toHaveBeenLastCalledWith({ after: "12", limit: 50 });
});
it("keeps a draft on stale-revision conflicts and reports recovery through Sonner", async () => {
  const { ApiClientError } = await import("@personal-os/api-client");
  h.api.updateFinanceTransaction.mockRejectedValue(
    new ApiClientError({ status: 409, code: "conflict", message: "Changed" }),
  );
  mount(<FinanceTransactionEditor />);
  fireEvent.change(await screen.findByLabelText("Notes"), { target: { value: "Keep this draft" } });
  fireEvent.click(screen.getByLabelText("Save changes"));
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(expect.stringContaining("changed elsewhere"), {
      id: "save",
    }),
  );
  expect(screen.getByLabelText("Notes")).toHaveValue("Keep this draft");
  expect(h.back).not.toHaveBeenCalled();
});
it("does not resubmit an unchanged draft or send a redundant category update", async () => {
  mount(<FinanceTransactionEditor />);
  fireEvent.change(await screen.findByLabelText("Notes"), { target: { value: "Temporary" } });
  fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "" } });
  fireEvent.click(screen.getByLabelText("Save changes"));
  expect(h.api.updateFinanceTransaction).not.toHaveBeenCalled();
  expect(h.info).toHaveBeenCalledWith("No changes to save");
});
it("changes a category without resending untouched notes", async () => {
  mount(<FinanceTransactionEditor />);
  fireEvent.click(await screen.findByRole("button", { name: /Category/ }));
  fireEvent.click(screen.getByRole("button", { name: "Travel" }));
  fireEvent.click(screen.getByLabelText("Save changes"));
  await waitFor(() => expect(h.success).toHaveBeenCalled());
  expect(h.api.updateFinanceTransaction).toHaveBeenCalledWith(transaction.id, {
    category: "Travel",
    expectedTransactionUpdatedAt: transaction.updatedAt,
  });
});
it("discards edits only after the explicit Cancel confirmation", async () => {
  mount(<FinanceTransactionEditor />);
  fireEvent.change(await screen.findByLabelText("Notes"), { target: { value: "Draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(h.back).not.toHaveBeenCalled();
  expect(h.alert).toHaveBeenCalledWith("Discard changes?", expect.any(String), expect.any(Array));
  const actions = h.alert.mock.calls[0][2];
  actions.find((action: { text: string }) => action.text === "Discard").onPress();
  expect(h.back).toHaveBeenCalled();
});

it("keeps removed schedule occurrences out of upcoming cash flow", async () => {
  h.params = { view: "Cash flow" };
  h.api.listFinanceRecurringOccurrences.mockResolvedValue({
    occurrences: [{ key: "old", displayName: "Removed bill", inCurrentSchedule: false }],
    unavailableSources: [],
  });
  mount(<FinancePlanScreen />);
  await screen.findByText("No scheduled income or bills in the next 30 days.");
  expect(screen.queryByText("Removed bill")).toBeNull();
});
it("refreshes owner-scoped records on tab focus and app foreground, then removes the listener", async () => {
  const { client } = mount(<FinanceAccountsScreen />);
  await screen.findByText("Everyday checking");
  const invalidate = vi.spyOn(client, "invalidateQueries");
  let stop: (() => void) | undefined;
  await act(async () => {
    stop = h.focus?.();
  });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["finances", "owner-a"] });
  invalidate.mockClear();
  await act(async () => {
    h.foreground?.("background");
  });
  expect(invalidate).not.toHaveBeenCalled();
  await act(async () => {
    h.foreground?.("active");
  });
  expect(invalidate).toHaveBeenCalledOnce();
  stop?.();
  expect(h.removeListener).toHaveBeenCalledOnce();
});
it("preserves cached layout on read failure and retries through one Sonner outcome", async () => {
  const { client } = mount(<FinanceAccountsScreen />);
  await screen.findByText("Everyday checking");
  h.api.listFinanceAccounts.mockRejectedValueOnce(new Error("Offline"));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["finances", "owner-a", "accounts"] });
  });
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Couldn’t load finance data",
      expect.objectContaining({ action: expect.any(Object) }),
    ),
  );
  expect(screen.getByText("Everyday checking")).toBeTruthy();
  expect(screen.queryByText("Refresh saved data")).toBeNull();
  const options = h.error.mock.calls.at(-1)?.[1];
  await act(async () => {
    options.action.onClick();
  });
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Finance data refreshed", { id: options.id }),
  );
  expect(h.loading).toHaveBeenCalledWith("Refreshing finance data…", { id: options.id });
});
it("retries the failed next-page cursor without refreshing loaded transaction pages", async () => {
  h.params = { mode: "Transactions" };
  h.api.listFinanceTransactions
    .mockResolvedValueOnce({ items: [transaction], nextCursor: "next-page" })
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce({
      items: [{ ...transaction, id: "next", merchant: "Bookshop" }],
      nextCursor: null,
    });
  mount(<FinanceSpendingScreen />);
  fireEvent.click(await screen.findByRole("button", { name: "Load more transactions" }));
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(screen.getByText("Corner market")).toBeTruthy();
  const options = h.error.mock.calls.at(-1)?.[1];
  await act(async () => {
    options.action.onClick();
  });
  await screen.findByText("Bookshop");
  expect(h.api.listFinanceTransactions.mock.calls.map(([args]) => args.cursor)).toEqual([
    undefined,
    "next-page",
    "next-page",
  ]);
});

it("deduplicates a shared account failure across retained screens and clears recovered notices", async () => {
  const { client } = mount(
    <>
      <FinanceAccountsScreen />
      <FinanceOverviewScreen />
    </>,
  );
  await screen.findByText("Everyday checking");
  const failure = new Error("Offline");
  h.api.listFinanceAccounts.mockRejectedValueOnce(failure);
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["finances", "owner-a", "accounts"] });
  });
  await waitFor(() => expect(h.error).toHaveBeenCalledTimes(1));
  const id = h.error.mock.calls[0][1].id;
  h.dismiss.mockClear();
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["finances", "owner-a", "accounts"] });
  });
  await waitFor(() => expect(h.dismiss).toHaveBeenCalledWith(id));
});

it("hands a shared read Retry to a surviving screen when its first observer unmounts", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <FinanceAccountsScreen />
      <FinanceOverviewScreen />
    </QueryClientProvider>,
  );
  await screen.findByText("Everyday checking");
  h.api.listFinanceAccounts.mockRejectedValueOnce(new Error("Offline"));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["finances", "owner-a", "accounts"] });
  });
  await waitFor(() => expect(h.error).toHaveBeenCalledOnce());
  const options = h.error.mock.calls[0][1];
  view.rerender(
    <QueryClientProvider client={client}>
      <FinanceOverviewScreen />
    </QueryClientProvider>,
  );
  await act(async () => {
    options.action.onClick();
  });
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Finance data refreshed", { id: options.id }),
  );
});
it("emits one scoped failure with the real mobile QueryCache provider", async () => {
  const { MobileDataProvider } = await import("../tasks/data");
  h.api.listFinanceAccounts.mockRejectedValue(new Error("Offline"));
  render(
    <MobileDataProvider>
      <FinanceAccountsScreen />
    </MobileDataProvider>,
  );
  await screen.findByText("Retry loading");
  expect(h.error).toHaveBeenCalledOnce();
  expect(h.error).toHaveBeenCalledWith(
    "Couldn’t load finance data",
    expect.objectContaining({ action: expect.any(Object) }),
  );
});

it("keeps modal Save above the keyboard and removes listeners after closing", async () => {
  const { useFormKeyboardOffset } = await import("../../components/forms/form-save");
  const { result, unmount } = renderHook(useFormKeyboardOffset);
  act(() =>
    h.keyboardListeners.get("keyboardWillChangeFrame")?.({ endCoordinates: { screenY: 520 } }),
  );
  expect(result.current).toBe(332);
  act(() =>
    h.keyboardListeners.get("keyboardWillChangeFrame")?.({ endCoordinates: { screenY: 900 } }),
  );
  expect(result.current).toBe(0);
  act(() => h.keyboardListeners.get("keyboardDidHide")?.());
  expect(result.current).toBe(0);
  unmount();
  expect(h.keyboardListeners.size).toBe(0);
});
