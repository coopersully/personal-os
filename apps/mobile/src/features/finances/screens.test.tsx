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
import TodayHome from "../briefing/today";
import { FinanceAccountsScreen } from "./accounts";
import { FinanceAssistantScreen } from "./assistant";
import { FinanceBudgetCategoryScreen, FinanceBudgetEditor } from "./budget-category";
import { FinanceTransactionScreen } from "./details";
import { InstitutionLogo } from "./institution-logo";
import { FinanceOverviewScreen } from "./overview";
import { FinancePlanScreen } from "./plan";
import { FinanceSpendingScreen } from "./spending";
import { FinanceTransactionEditor } from "./transaction-editor";

vi.mock("react-native-svg", () => ({
  default: "svg",
  Circle: "circle",
  Defs: "defs",
  LinearGradient: "linearGradient",
  RadialGradient: "radialGradient",
  Rect: "rect",
  Stop: "stop",
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("@tanstack/react-query", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/apps/web/package.json`)("@tanstack/react-query");
});
type ChatScrollEvents = {
  onContentSizeChange: () => void;
  onLayout: () => void;
  onScroll: (event: {
    nativeEvent: {
      contentOffset: { y: number };
      layoutMeasurement: { height: number };
      contentSize: { height: number };
    };
  }) => void;
};
const h = vi.hoisted(() => ({
  chatScroll: {} as ChatScrollEvents,
  scrollToEnd: vi.fn(),
  keyboardListeners: new Map<string, (event?: { endCoordinates: { screenY: number } }) => void>(),
  focus: undefined as undefined | (() => (() => void) | undefined),
  foreground: undefined as undefined | ((state: string) => void),
  removeListener: vi.fn(),
  owner: "owner-a",
  timezone: "America/New_York" as string | undefined,
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
    listTaskWorkspace: vi.fn(),
    listFinanceAccounts: vi.fn(),
    getFinanceSpending: vi.fn(),
    listFinanceActivity: vi.fn(),
    listFinanceTransactions: vi.fn(),
    listFinanceSpendingTransactions: vi.fn(),
    getFinanceBudget: vi.fn(),
    createFinanceBudget: vi.fn(),
    getFinanceBudgetStatus: vi.fn().mockResolvedValue([]),
    getFinanceConversationReadiness: vi.fn().mockResolvedValue({ canSend: true }),
    sendFinanceConversationMessage: vi.fn().mockResolvedValue({ id: "sent" }),
    listFinanceGoals: vi.fn(),
    listFinanceRecurringOccurrences: vi.fn(),
    listFinanceRecurringObligations: vi.fn().mockResolvedValue([]),
    getFinanceReviewQueue: vi.fn(),
    updateFinanceAccount: vi.fn(),
    resolveFinanceReview: vi.fn().mockResolvedValue({ applied: true }),
    getFinanceConversationHistory: vi.fn(),
    getFinanceTransaction: vi.fn(),
    getFinanceCategories: vi.fn(),
    updateFinanceTransaction: vi.fn(),
  },
}));
vi.mock("react-native", () => {
  const Box = ({
    children,
    ref,
    style,
  }: PropsWithChildren<{
    ref?: {
      current: {
        measureInWindow: (
          callback: (x: number, y: number, width: number, height: number) => void,
        ) => void;
      } | null;
    };
    style?: { paddingBottom?: number };
  }>) => {
    if (ref) ref.current = { measureInWindow: (callback) => callback(0, 200, 393, 600) };
    return (
      <div data-testid={ref ? "chat-frame" : undefined} data-padding-bottom={style?.paddingBottom}>
        {children}
      </div>
    );
  };
  return {
    StyleSheet: { absoluteFill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 } },
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
    Image: ({ source, onError }: { source: { uri: string }; onError: () => void }) => (
      <img alt="institution artwork" src={source.uri} onError={onError} />
    ),
    View: Box,
    ScrollView: ({
      children,
      accessibilityLabel,
      ref,
      ...props
    }: PropsWithChildren<
      ChatScrollEvents & {
        accessibilityLabel?: string;
        ref?: { current: { scrollToEnd: typeof h.scrollToEnd } | null };
      }
    >) => {
      if (accessibilityLabel === "Finance conversation history") {
        h.chatScroll = props;
        if (ref) ref.current = { scrollToEnd: h.scrollToEnd };
      }
      return <section aria-label={accessibilityLabel}>{children}</section>;
    },
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
    state: { user: { id: h.owner, planningTimezone: h.timezone } },
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
  provider: "manual",
  ownershipType: "individual",
  ownershipShare: 1,
  synchronization: { state: "current", lastSuccessAt: null },
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
  h.api.listTaskWorkspace.mockReset().mockResolvedValue({ items: [], total: 0, nextCursor: null });
  h.api.getFinanceBudgetStatus.mockResolvedValue([]);
  h.owner = "owner-a";
  h.timezone = "America/New_York";
  h.params = { id: "transaction-1" };
  h.api.listFinanceAccounts.mockResolvedValue({
    accounts: [account],
    totals: { cash: 2400, netWorth: 2400, debt: 0, investments: 0, otherAssets: 0 },
    accountSemantics: {
      possibleDuplicateGroups: [],
      unresolvedOwnershipAccountIds: [],
      excludedAccountIds: [],
      trustworthy: true,
    },
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
  h.api.resolveFinanceReview.mockResolvedValue({ applied: true, transaction });
});
afterEach(cleanup);
it("shows real amounts and source qualifications without a duplicate review read", async () => {
  mount(<FinanceOverviewScreen />);
  expect(await screen.findByText("$42.00")).toBeTruthy();
  expect(screen.getByText("Partial total")).toBeTruthy();
  expect(screen.queryByText(/Your share of spending/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "About spent this month" }));
  expect(screen.getByText(/Your share of spending/)).toBeTruthy();
  expect(screen.getByText(/Only part of this month/)).toBeTruthy();
  expect(screen.getByText("Some sources need an update.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Close information" }));
  expect(screen.queryByText(/Your share of spending/)).toBeNull();
  expect(h.api.getFinanceReviewQueue).not.toHaveBeenCalled();
});
it("keeps mixed currency totals out of overview", async () => {
  h.api.listFinanceAccounts.mockResolvedValue({
    accounts: [account, { ...account, id: "eur", currencyCode: "EUR" }],
    totals: { cash: 9999, netWorth: 9999 },
    accountSemantics: {
      possibleDuplicateGroups: [],
      unresolvedOwnershipAccountIds: [],
      excludedAccountIds: [],
      trustworthy: false,
    },
  });
  mount(<FinanceOverviewScreen />);
  expect((await screen.findAllByText("Unavailable")).length).toBe(2);
  expect(screen.queryByText(/9,999/)).toBeNull();
});
it("opens accounts and keeps search in the shared header", async () => {
  const view = mount(<FinanceAccountsScreen />);
  fireEvent.click(await screen.findByRole("button", { name: /Everyday checking/ }));
  expect(h.push).toHaveBeenCalledWith({ pathname: "/finance-account", params: { id: account.id } });
  expect(screen.queryByLabelText("Search accounts")).toBeNull();
  h.params = { accountSearch: "missing" };
  view.rerender(
    <QueryClientProvider client={view.client}>
      <FinanceAccountsScreen />
    </QueryClientProvider>,
  );
  expect(screen.getByText("No matching accounts in this tab.")).toBeTruthy();
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
it.each([
  "pending_review",
  "needs_input",
])("closes a %s submission without discarding an already-submitted proposal", async (status) => {
  h.api.updateFinanceTransaction.mockResolvedValue({ status, review: {} });
  mount(<FinanceTransactionEditor />);
  fireEvent.change(await screen.findByLabelText("Notes"), { target: { value: "Review this" } });
  fireEvent.click(screen.getByLabelText("Save changes"));
  await waitFor(() => expect(h.info).toHaveBeenCalled());
  expect(h.success).not.toHaveBeenCalled();
  expect(h.back).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Save changes")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(h.back).toHaveBeenCalledOnce();
  expect(h.alert).not.toHaveBeenCalled();
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
    accountSemantics: {
      possibleDuplicateGroups: [],
      unresolvedOwnershipAccountIds: [],
      excludedAccountIds: [],
      trustworthy: true,
    },
  });
  mount(<FinanceOverviewScreen />);
  expect((await screen.findAllByText("Unavailable")).length).toBe(2);
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
  await screen.findByText("Spending contribution: $20.00");
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
it("shows transaction notes, splits, and provenance with the USD default", async () => {
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
  expect(screen.getByText("Pending")).toBeTruthy();
  expect(screen.getByText("Confirmed by owner")).toBeTruthy();
  expect(screen.getByText("Personal")).toBeTruthy();
  expect(screen.getByText("$20.00")).toBeTruthy();
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
      assumptions: ["Income remains stable", "Income remains stable"],
    },
  });
  mount(<FinancePlanScreen />);
  await screen.findByText("Proposal — not approved · v2");
  expect(screen.getByText("Salary")).toBeTruthy();
  expect(screen.getAllByText("Income remains stable")).toHaveLength(2);
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
  await screen.findByText(/−\$500.00/);
  expect(screen.getByText("Unavailable")).toBeTruthy();
  expect(screen.getByText(/1 sources need schedule confirmation/)).toBeTruthy();
});
it("shows goals and suppresses untrustworthy wealth aggregates", async () => {
  h.params = { view: "Wealth" };
  h.api.listFinanceAccounts.mockResolvedValue({
    accounts: [account],
    totals: { netWorth: 999999 },
    accountSemantics: {
      possibleDuplicateGroups: [],
      unresolvedOwnershipAccountIds: [],
      excludedAccountIds: [],
      trustworthy: false,
    },
  });
  h.api.listFinanceGoals.mockResolvedValue({ data: [{ id: "goal", name: "Emergency fund" }] });
  mount(<FinancePlanScreen />);
  await screen.findByText("Emergency fund");
  expect(screen.getAllByText("$2,400.00").length).toBeGreaterThan(0);
  expect(screen.queryByText(/999,999/)).toBeNull();
});
it("opens canonical transaction details from a review", async () => {
  h.api.getFinanceReviewQueue.mockResolvedValue([
    { id: "review", rationale: null, reason: "unknown_merchant", transaction },
  ]);
  mount(<FinanceAssistantScreen />);
  fireEvent.click(await screen.findByRole("button", { name: /^Corner market/ }));
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
  const invalidate = vi.spyOn(client, "refetchQueries");
  let stop: (() => void) | undefined;
  await act(async () => {
    stop = h.focus?.();
  });
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: ["finances", "owner-a", "accounts"],
    type: "active",
    stale: true,
  });
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

it("opens the canonical destinations from Overview metrics, schedules and activity", async () => {
  h.api.listFinanceActivity.mockResolvedValue({
    entries: [
      {
        id: "changed",
        action: "Category updated",
        explanation: "Owner reviewed",
        status: "applied",
      },
    ],
    nextCursor: null,
  });
  mount(<FinanceOverviewScreen />);
  for (const [name, target] of [
    [
      /^Spent this month,/,
      { pathname: "/finances/spending", params: { period: "month", mode: "Summary" } },
    ],
    [/^Cash/, "/finances/accounts"],
    [/Net worth/, { pathname: "/finances/plan", params: { view: "Wealth" } }],
    [
      /See upcoming income and bills/,
      { pathname: "/finances/plan", params: { view: "Cash flow" } },
    ],
    [/Category updated/, { pathname: "/finances/assistant", params: { view: "Activity" } }],
  ] as const) {
    fireEvent.click(await screen.findByRole("button", { name }));
    expect(h.navigate).toHaveBeenLastCalledWith(target);
  }
});

it("keeps Assistant shortcuts on their matching canonical view", async () => {
  const view = mount(<FinanceAssistantScreen />);
  fireEvent.click(await screen.findByRole("button", { name: /Your Finance conversation/ }));
  await screen.findByText("Your Finance conversation will appear here.");
  expect(h.setParams).toHaveBeenLastCalledWith({ view: "Conversation" });
  view.unmount();
  mount(<FinanceAssistantScreen />);
  fireEvent.click(await screen.findByRole("button", { name: /Recorded activity/ }));
  await screen.findByText("No recorded activity yet.");
  expect(h.setParams).toHaveBeenLastCalledWith({ view: "Activity" });
});
it("resets the spending drill-down when changing period and opens full transaction details", async () => {
  mount(<FinanceSpendingScreen />);
  fireEvent.click(await screen.findByRole("button", { name: /Groceries/ }));
  fireEvent.click(await screen.findByRole("button", { name: /^Corner market/ }));
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/finance-transaction",
    params: { id: transaction.id },
  });
  fireEvent.click(screen.getByRole("button", { name: /All categories/ }));
  expect(screen.queryByText(/Spending contribution:/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "This month" }));
  expect(h.setParams).toHaveBeenLastCalledWith({ period: "month" });
  fireEvent.click(screen.getByRole("button", { name: "This week" }));
  expect(h.setParams).toHaveBeenLastCalledWith({ period: "week" });
});
it("preserves actionable source and planning state across account groups", async () => {
  h.api.listFinanceAccounts.mockResolvedValue({
    accounts: [
      { ...account, status: "needs_reauth", includeInPlanning: false },
      {
        ...account,
        id: "investment",
        name: "Brokerage",
        kind: "investment",
        status: "connected",
        lastSyncedAt: "2026-11-07T12:00:00Z",
      },
      {
        ...account,
        id: "debt",
        name: "Credit card",
        kind: "debt",
        status: "connected",
        lastSyncedAt: null,
      },
    ],
  });
  mount(<FinanceAccountsScreen />);
  expect(await screen.findByText(/Reconnect needed.*Excluded from planning/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Debt" }));
  expect(screen.getByText(/Not synced/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Investments" }));
  expect(screen.getByText(/Updated /)).toBeTruthy();
  expect(screen.queryByText("Credit card")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Brokerage/ }));
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/finance-account",
    params: { id: "investment" },
  });
});

it.each([
  "active",
  "superseded",
])("preserves the %s budget state and missing-description fallbacks", async (status) => {
  h.api.getFinanceBudget.mockResolvedValue({
    data: {
      allocatedTotal: 0,
      effectiveFrom: "2026-11",
      status,
      version: 3,
      rationale: "Current allocation",
      allocations: [{ key: "reserve", kind: "saving", amount: 0 }],
      resources: [{ key: "salary", kind: "income", amount: 0 }],
      assumptions: [],
    },
  });
  mount(<FinancePlanScreen />);
  await screen.findByText(`${status === "active" ? "" : "Superseded · "}v3`);
  expect(screen.getByText("reserve")).toBeTruthy();
  expect(screen.getByText("salary")).toBeTruthy();
  expect(screen.queryByText("Assumptions")).toBeNull();
});
it("keeps successful data visible when manual refresh fails again and offers another retry", async () => {
  const view = mount(<FinanceAccountsScreen />);
  await screen.findByText("Everyday checking");
  h.api.listFinanceAccounts.mockRejectedValue(new Error("Still offline"));
  await act(async () => {
    await view.client.invalidateQueries({ queryKey: ["finances", "owner-a", "accounts"] });
  });
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith("Couldn’t load finance data", expect.any(Object)),
  );
  const first = h.error.mock.calls.find(([message]) => message === "Couldn’t load finance data");
  expect(first).toBeTruthy();
  await act(async () => {
    first?.[1].action.onClick();
  });
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Couldn’t refresh finance data",
      expect.objectContaining({ id: first?.[1].id, action: expect.any(Object) }),
    ),
  );
  expect(screen.getByText("Everyday checking")).toBeTruthy();
  expect(screen.queryByText("Couldn’t refresh finance data")).toBeNull();
  h.api.listFinanceAccounts.mockResolvedValue({
    accounts: [],
    totals: {},
    accountSemantics: {
      possibleDuplicateGroups: [],
      unresolvedOwnershipAccountIds: [],
      excludedAccountIds: [],
      trustworthy: true,
    },
  });
  const retry = h.error.mock.calls.find(([message]) => message === "Couldn’t refresh finance data");
  await act(async () => {
    retry?.[1].action.onClick();
  });
  await screen.findByText("No accounts yet. Connected and manual accounts will appear here.");
  expect(h.success).toHaveBeenCalledWith("Finance data refreshed", { id: first?.[1].id });
});
it("shows signs and unknown currency without losing income or transfer records", async () => {
  h.params = { mode: "Transactions", period: "month" };
  h.api.listFinanceTransactions.mockResolvedValue({
    items: [
      {
        ...transaction,
        id: "income",
        merchant: "Payroll",
        direction: "income",
        currencyCode: null,
        category: null,
        pending: true,
      },
      { ...transaction, id: "transfer", merchant: "Account transfer", direction: "transfer" },
    ],
    nextCursor: null,
  });
  mount(<FinanceSpendingScreen />);
  await screen.findByText("Payroll");
  expect(screen.getByText("+$42.00")).toBeTruthy();
  expect(screen.getByText(/Uncategorized.*Pending/)).toBeTruthy();
  expect(screen.getByText("Account transfer")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Transactions" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

it("does not infer a financial date scope when the user timezone is unavailable", async () => {
  h.timezone = undefined;
  mount(<FinanceOverviewScreen />);
  await screen.findByText("Cash");
  expect(h.api.getFinanceSpending).not.toHaveBeenCalled();
  expect(h.api.listFinanceRecurringOccurrences).not.toHaveBeenCalled();
});
it("does not fetch or install foreground refresh for an absent owner", async () => {
  h.owner = "";
  mount(<FinanceAccountsScreen />);
  await act(async () => {
    expect(h.focus?.()).toBeUndefined();
  });
  expect(h.api.listFinanceAccounts).not.toHaveBeenCalled();
});
it("does not show a late save failure after the editor is closed", async () => {
  let reject!: (reason: Error) => void;
  h.api.updateFinanceTransaction.mockReturnValue(
    new Promise((_resolve, fail) => {
      reject = fail;
    }),
  );
  const view = mount(<FinanceTransactionEditor />);
  fireEvent.change(await screen.findByLabelText("Notes"), { target: { value: "Later" } });
  fireEvent.click(screen.getByLabelText("Save changes"));
  view.unmount();
  await act(async () => {
    reject(new Error("offline"));
  });
  expect(h.dismiss).toHaveBeenCalledWith("save");
  expect(h.error).not.toHaveBeenCalled();
  expect(h.back).not.toHaveBeenCalled();
});

it("keeps the selected period in transactions and applies server search and status", async () => {
  h.params = { mode: "Transactions", period: "month" };
  mount(<FinanceSpendingScreen />);
  await screen.findByLabelText("Search transactions");
  fireEvent.change(screen.getByLabelText("Search transactions"), { target: { value: "coffee" } });
  fireEvent.click(screen.getByRole("button", { name: "Pending" }));
  await waitFor(() =>
    expect(h.api.listFinanceTransactions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        search: "coffee",
        pending: true,
        from: expect.stringMatching(/-01$/),
        to: expect.any(String),
      }),
    ),
  );
});
it("offers timezone recovery instead of a disabled query spinner", async () => {
  h.timezone = undefined;
  mount(<FinanceSpendingScreen />);
  fireEvent.click(await screen.findByRole("button", { name: /Set your timezone/ }));
  expect(h.navigate).toHaveBeenCalledWith("/settings");
  expect(h.api.getFinanceSpending).not.toHaveBeenCalled();
});
it("sends a conversation message with a retained key after uncertain delivery", async () => {
  h.params = { view: "Conversation" };
  h.api.sendFinanceConversationMessage.mockRejectedValueOnce(new Error("offline"));
  mount(<FinanceAssistantScreen />);
  fireEvent.change(await screen.findByLabelText("Message nohmi"), {
    target: { value: "Review my budget" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  const first = h.api.sendFinanceConversationMessage.mock.calls[0][0];
  expect(screen.getByLabelText("Message nohmi")).toHaveProperty("value", "Review my budget");
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(h.success).toHaveBeenCalledWith("Message sent", expect.anything()));
  expect(h.api.sendFinanceConversationMessage.mock.calls[1][0]).toEqual(first);
});

it("does not send when the Finance host is unavailable", async () => {
  h.params = { view: "Conversation" };
  h.api.getFinanceConversationReadiness.mockResolvedValueOnce({
    canSend: false,
    reason: "registration_missing",
  });
  mount(<FinanceAssistantScreen />);
  fireEvent.change(await screen.findByLabelText("Message nohmi"), {
    target: { value: "Review my budget" },
  });
  expect(screen.getByRole("button", { name: "Send message" })).toHaveProperty("disabled", true);
  expect(h.api.sendFinanceConversationMessage).not.toHaveBeenCalled();
});
it("resolves a category review against its displayed revision without learning a merchant rule", async () => {
  h.api.getFinanceReviewQueue.mockResolvedValue([
    {
      id: "review",
      transaction: { ...transaction, categoryId: "groceries" },
      reason: "low_confidence",
      rationale: "Check category",
    },
  ]);
  h.params = { id: transaction.id };
  h.api.getFinanceTransaction.mockResolvedValue({
    data: { ...transaction, category: "Groceries", categoryId: "groceries" },
  });
  mount(<FinanceTransactionScreen />);
  fireEvent.click(await screen.findByRole("button", { name: "Approve category" }));
  await waitFor(() =>
    expect(h.api.resolveFinanceReview).toHaveBeenCalledWith("review", {
      action: "approve",
      expectedTransactionUpdatedAt: transaction.updatedAt,
      learnMerchant: "never",
      rationale: null,
    }),
  );
  expect(h.success).toHaveBeenCalledWith("Category updated", expect.anything());
});
it("does not offer category approval for an ambiguous transfer", async () => {
  h.api.getFinanceReviewQueue.mockResolvedValue([
    {
      id: "review",
      transaction: { ...transaction, categoryId: "groceries" },
      reason: "possible_transfer",
    },
  ]);
  h.params = { id: transaction.id };
  h.api.getFinanceTransaction.mockResolvedValue({
    data: { ...transaction, category: null, categoryId: null },
  });
  mount(<FinanceTransactionScreen />);
  await screen.findByRole("button", { name: /^Category/ });
  expect(screen.queryByRole("button", { name: "Approve category" })).toBeNull();
});

it("keeps healthy overview cards quiet and opens account explanations without navigating", async () => {
  h.api.getFinanceSpending.mockResolvedValueOnce({
    ...spending,
    snapshot: { ...spending.snapshot, coverage: "complete" },
    source: { freshness: "current" },
  });
  mount(<FinanceOverviewScreen />);
  await screen.findByText("$42.00");
  expect(screen.queryByText("Partial total")).toBeNull();
  expect(screen.queryByText("Needs update")).toBeNull();
  expect(screen.queryByText("Included account balances")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "About cash" }));
  expect(screen.getByText("Included accounts")).toBeTruthy();
  expect(screen.getByText("Everyday checking")).toBeTruthy();
  expect(h.navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Close information" }));
  fireEvent.click(screen.getByRole("button", { name: /^Cash,/ }));
  expect(h.navigate).toHaveBeenCalledWith("/finances/accounts");
});
it("keeps a short freshness warning visible and explains it in the sheet", async () => {
  h.api.getFinanceSpending.mockResolvedValueOnce({
    ...spending,
    snapshot: { ...spending.snapshot, coverage: "complete" },
    source: { freshness: "unknown" },
  });
  mount(<FinanceOverviewScreen />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Spent this month: Needs update. Show explanation" }),
  );
  expect(screen.getByText("Source freshness hasn’t been confirmed.")).toBeTruthy();
});

it("shows category spending against limits alongside the budget without hiding overspending", async () => {
  h.api.getFinanceBudgetStatus.mockResolvedValueOnce([
    { budget: { id: "one", category: "Dining", limit: 100 }, spent: 125, remaining: -25 },
    { budget: { id: "two", category: "Groceries", limit: 200 }, spent: 0, remaining: 200 },
  ]);
  mount(<FinancePlanScreen />);
  await screen.findByText("$25.00 over");
  expect(screen.getByText("$125.00 of $100.00")).toBeTruthy();
  expect(screen.getByText("$0.00 of $200.00")).toBeTruthy();
  expect(screen.queryByText("Category limits")).toBeNull();
  expect(screen.queryByText("Monthly category limits")).toBeNull();
});
it("keeps Other accounts reachable when present", async () => {
  h.api.listFinanceAccounts.mockResolvedValueOnce({
    accounts: [{ ...account, kind: "other", name: "Property" }],
  });
  mount(<FinanceAccountsScreen />);
  fireEvent.click(await screen.findByRole("button", { name: "Other" }));
  expect(screen.getByText("Property")).toBeTruthy();
});

it.each([
  50, 125,
])("shows %s percent of the total budget spent, including spending outside category limits", async (percent) => {
  const month = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
  h.api.getFinanceBudget.mockResolvedValue({
    data: {
      allocatedTotal: 100,
      effectiveFrom: month,
      status: "active",
      version: 1,
      allocations: [],
      resources: [],
      assumptions: [],
    },
  });
  h.api.getFinanceSpending.mockResolvedValue({
    ...spending,
    snapshot: { ...spending.snapshot, netCents: percent * 100 },
  });
  mount(<FinancePlanScreen />);
  await screen.findByText(`${percent}%`);
  expect(screen.getByText("v1")).toBeTruthy();
  expect(screen.queryByText(/Approved/)).toBeNull();
  expect(screen.getByText("Partial total")).toBeTruthy();
});

const categoryBudget = {
  id: "budget-1",
  category: "Groceries",
  month: "2026-11",
  limit: 600,
  updatedAt: "2026-11-01T12:00:00Z",
  bucketId: null,
};
it("opens a budget category and scopes its transactions by budget identity", async () => {
  h.params = { id: categoryBudget.id, month: categoryBudget.month };
  h.api.getFinanceBudgetStatus.mockResolvedValue([
    { budget: categoryBudget, spent: 42, remaining: 558 },
  ]);
  mount(<FinanceBudgetCategoryScreen />);
  await screen.findByText("Monthly limit");
  await waitFor(() =>
    expect(h.api.listFinanceTransactions).toHaveBeenCalledWith(
      expect.objectContaining({ budgetId: "budget-1" }),
    ),
  );
  fireEvent.click(screen.getByText("Monthly limit"));
  expect(screen.getByLabelText("Monthly budget limit")).toHaveProperty("value", "600");
  expect(h.push).not.toHaveBeenCalled();
});
it.each([
  "applied",
  "pending_review",
])("saves a budget revision and honestly handles %s", async (status) => {
  h.params = { id: categoryBudget.id, month: categoryBudget.month };
  h.api.getFinanceBudgetStatus.mockResolvedValue([
    { budget: categoryBudget, spent: 42, remaining: 558 },
  ]);
  h.api.createFinanceBudget.mockResolvedValue(
    status === "applied" ? { ...categoryBudget, limit: 700 } : { status },
  );
  mount(<FinanceBudgetEditor />);
  const input = await screen.findByLabelText("Monthly budget limit");
  expect(screen.getByText("Close")).toBeTruthy();
  fireEvent.change(input, { target: { value: "700" } });
  expect(screen.getByText("Cancel")).toBeTruthy();
  fireEvent.click(screen.getByLabelText("Save changes"));
  await waitFor(() =>
    expect(h.api.createFinanceBudget).toHaveBeenCalledWith(
      expect.objectContaining({
        budgetId: "budget-1",
        expectedBudgetUpdatedAt: categoryBudget.updatedAt,
        limit: 700,
      }),
    ),
  );
  if (status === "applied")
    await waitFor(() =>
      expect(h.success).toHaveBeenCalledWith("Budget limit updated", expect.anything()),
    );
  else {
    await waitFor(() =>
      expect(h.info).toHaveBeenCalledWith(
        "Submitted for approval. The limit has not changed.",
        expect.anything(),
      ),
    );
    expect(h.success).not.toHaveBeenCalled();
  }
});
it("rejects invalid budget limits without sending a mutation", async () => {
  h.params = { id: categoryBudget.id, month: categoryBudget.month };
  h.api.getFinanceBudgetStatus.mockResolvedValue([
    { budget: categoryBudget, spent: 42, remaining: 558 },
  ]);
  mount(<FinanceBudgetEditor />);
  fireEvent.change(await screen.findByLabelText("Monthly budget limit"), {
    target: { value: "-2" },
  });
  fireEvent.click(screen.getByLabelText("Save changes"));
  expect(h.error).toHaveBeenCalled();
  expect(h.api.createFinanceBudget).not.toHaveBeenCalled();
});
it("uses institution artwork and falls back to initials after image failure", () => {
  const logo = "data:image/png;base64,iVBORw0KGgoAAA==";
  mount(
    <InstitutionLogo
      account={{
        institution: "Example Bank",
        institutionBranding: { institutionId: "test", logo, primaryColor: null, url: null },
      }}
    />,
  );
  fireEvent.error(screen.getByAltText("institution artwork"));
  expect(screen.getByText("EB")).toBeTruthy();
});

it("makes category and empty notes directly editable on transaction details", async () => {
  const { FinanceTransactionScreen } = await import("./details");
  h.api.getFinanceTransaction.mockResolvedValue({ data: { ...transaction, notes: null } });
  mount(<FinanceTransactionScreen />);
  fireEvent.click(await screen.findByRole("button", { name: /^Category/ }));
  await screen.findByLabelText("Search categories");
  expect(h.push).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: /Notes.*Add a note/ }));
  expect(screen.getByLabelText("Transaction note")).toBeTruthy();
  expect(h.push).not.toHaveBeenCalled();
});
it("opens category selection directly and saves category with a note in one edit", async () => {
  h.params = { id: transaction.id, field: "category" };
  mount(<FinanceTransactionEditor />);
  fireEvent.click(await screen.findByRole("button", { name: "Travel" }));
  fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Dinner with Maya." } });
  fireEvent.click(screen.getByLabelText("Save changes"));
  await waitFor(() => expect(h.success).toHaveBeenCalled());
  expect(h.api.updateFinanceTransaction).toHaveBeenCalledWith(transaction.id, {
    category: "Travel",
    notes: "Dinner with Maya.",
    expectedTransactionUpdatedAt: transaction.updatedAt,
  });
});

it("keeps the composer outside the transcript and avoids pulling readers to the bottom", async () => {
  h.params = { view: "Conversation" };
  h.api.getFinanceConversationHistory.mockResolvedValue({
    messages: [
      {
        id: "message",
        authorKind: "user",
        text: "Review my spending",
        createdAt: "2026-11-09T12:00:00Z",
      },
    ],
    nextCursor: null,
  });
  mount(<FinanceAssistantScreen />);
  await screen.findByText("Review my spending");
  const history = screen.getByLabelText("Finance conversation history");
  expect(history.contains(screen.getByLabelText("Message nohmi"))).toBe(false);
  act(() => h.chatScroll.onContentSizeChange());
  expect(h.scrollToEnd).toHaveBeenCalledWith({ animated: false });
  h.scrollToEnd.mockClear();
  act(() =>
    h.chatScroll.onScroll({
      nativeEvent: {
        contentOffset: { y: 50 },
        layoutMeasurement: { height: 400 },
        contentSize: { height: 1000 },
      },
    }),
  );
  act(() => h.chatScroll.onContentSizeChange());
  expect(h.scrollToEnd).not.toHaveBeenCalled();
  act(() =>
    h.chatScroll.onScroll({
      nativeEvent: {
        contentOffset: { y: 590 },
        layoutMeasurement: { height: 400 },
        contentSize: { height: 1000 },
      },
    }),
  );
  act(() => h.chatScroll.onLayout());
  expect(h.scrollToEnd).toHaveBeenCalled();
});

it("shrinks the chat region above the keyboard and restores it on dismissal", async () => {
  h.params = { view: "Conversation" };
  const view = mount(<FinanceAssistantScreen />);
  await screen.findByLabelText("Message nohmi");
  act(() => h.keyboardListeners.get("keyboardDidShow")?.({ endCoordinates: { screenY: 500 } }));
  expect(screen.getByTestId("chat-frame").firstElementChild).toHaveAttribute(
    "data-padding-bottom",
    "300",
  );
  act(() => h.keyboardListeners.get("keyboardDidHide")?.());
  expect(screen.getByTestId("chat-frame").firstElementChild).toHaveAttribute(
    "data-padding-bottom",
    "0",
  );
  view.unmount();
  expect(h.keyboardListeners.has("keyboardDidShow")).toBe(false);
});

it("keeps the accessible circular Send action inside the message field", async () => {
  h.params = { view: "Conversation" };
  mount(<FinanceAssistantScreen />);
  const input = await screen.findByLabelText("Message nohmi");
  const send = screen.getByRole("button", { name: "Send message" });
  expect(input.parentElement?.contains(send)).toBe(true);
  expect(send.querySelector('[data-icon="send"]')).not.toBeNull();
  expect(send).toBeDisabled();
  fireEvent.change(input, { target: { value: "Review my budget" } });
  expect(send).toBeEnabled();
});

it("opens chat from a transaction with its record attached", async () => {
  const { FinanceTransactionScreen } = await import("./details");
  h.params = { id: transaction.id };
  mount(<FinanceTransactionScreen />);
  fireEvent.click(await screen.findByRole("button", { name: /Message nohmi/ }));
  expect(h.navigate).toHaveBeenCalledWith({
    pathname: "/finances/assistant",
    params: { view: "Conversation", transactionId: transaction.id },
  });
});
it("sends the attachment with a stable retry key and clears it only after receipt", async () => {
  h.params = { view: "Conversation", transactionId: transaction.id };
  h.api.sendFinanceConversationMessage.mockRejectedValueOnce(new Error("offline"));
  mount(<FinanceAssistantScreen />);
  await screen.findByText("Corner market · $42.00");
  fireEvent.change(screen.getByLabelText("Message nohmi"), {
    target: { value: "This was a gift" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  const first = h.api.sendFinanceConversationMessage.mock.calls[0][0];
  expect(first.recordRefs).toEqual([{ kind: "transaction", id: transaction.id }]);
  expect(h.setParams).not.toHaveBeenCalledWith({ transactionId: undefined });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(h.success).toHaveBeenCalledWith("Message sent", expect.anything()));
  expect(h.api.sendFinanceConversationMessage.mock.calls[1][0]).toEqual(first);
  expect(h.setParams).toHaveBeenCalledWith({ transactionId: undefined });
});
it("removes the attachment without losing the message draft", async () => {
  h.params = { view: "Conversation", transactionId: transaction.id };
  const view = mount(<FinanceAssistantScreen />);
  await screen.findByText("Corner market · $42.00");
  fireEvent.change(screen.getByLabelText("Message nohmi"), {
    target: { value: "A general question" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Remove transaction attachment" }));
  expect(h.setParams).toHaveBeenCalledWith({ transactionId: undefined });
  h.params = { view: "Conversation" };
  view.rerender(
    <QueryClientProvider client={view.client}>
      <FinanceAssistantScreen />
    </QueryClientProvider>,
  );
  expect(screen.getByLabelText("Message nohmi")).toHaveProperty("value", "A general question");
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(h.api.sendFinanceConversationMessage).toHaveBeenCalled());
  expect(h.api.sendFinanceConversationMessage.mock.calls[0][0].recordRefs).toEqual([]);
});
it("blocks sending a missing transaction until its attachment is removed", async () => {
  h.params = { view: "Conversation", transactionId: "missing" };
  h.api.getFinanceTransaction.mockRejectedValueOnce(new Error("not found"));
  mount(<FinanceAssistantScreen />);
  await screen.findByText("Transaction unavailable");
  fireEvent.change(screen.getByLabelText("Message nohmi"), { target: { value: "Question" } });
  expect(screen.getByRole("button", { name: "Send message" })).toHaveProperty("disabled", true);
  expect(h.api.sendFinanceConversationMessage).not.toHaveBeenCalled();
});
it("offers direct approval for an unassigned transaction with a suggested category", async () => {
  h.api.getFinanceReviewQueue.mockResolvedValue([
    {
      id: "review",
      transaction: { ...transaction, category: null, categoryId: null },
      suggestedCategory: { id: "gifts", name: "Gifts" },
      reason: "low_confidence",
    },
  ]);
  h.params = { id: transaction.id };
  h.api.getFinanceTransaction.mockResolvedValue({
    data: { ...transaction, category: null, categoryId: null },
  });
  mount(<FinanceTransactionScreen />);
  await screen.findByText("Gifts");
  fireEvent.click(screen.getByRole("button", { name: "Approve category" }));
  await waitFor(() =>
    expect(h.api.resolveFinanceReview).toHaveBeenCalledWith(
      "review",
      expect.objectContaining({
        action: "approve",
        expectedTransactionUpdatedAt: transaction.updatedAt,
      }),
    ),
  );
});

it("uses a new delivery key when an uncertain draft loses its attachment", async () => {
  h.params = { view: "Conversation", transactionId: transaction.id };
  h.api.sendFinanceConversationMessage.mockRejectedValueOnce(new Error("offline"));
  const view = mount(<FinanceAssistantScreen />);
  await screen.findByText("Corner market · $42.00");
  fireEvent.change(screen.getByLabelText("Message nohmi"), { target: { value: "Question" } });
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  const first = h.api.sendFinanceConversationMessage.mock.calls[0][0];
  h.params = { view: "Conversation" };
  view.rerender(
    <QueryClientProvider client={view.client}>
      <FinanceAssistantScreen />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(h.api.sendFinanceConversationMessage).toHaveBeenCalledTimes(2));
  const second = h.api.sendFinanceConversationMessage.mock.calls[1][0];
  expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  expect(second.recordRefs).toEqual([]);
});

it("flags a missing category on details but does not require optional notes", async () => {
  h.params = { id: transaction.id };
  h.api.getFinanceTransaction.mockResolvedValue({
    data: { ...transaction, category: null, categoryId: null },
  });
  mount(<FinanceTransactionScreen />);
  await screen.findByText("Uncategorized");
  expect(screen.queryByRole("button", { name: "Choose category" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^Category/ }));
  await screen.findByLabelText("Search categories");
  expect(h.push).not.toHaveBeenCalled();
});
it("keeps categorized transactions with no review quiet even without notes", async () => {
  h.params = { id: transaction.id };
  mount(<FinanceTransactionScreen />);
  await screen.findByText("$42.00");
  expect(screen.queryByText("Needs your input")).toBeNull();
});

it("recategorizes directly and clears attention only after a confirmed review receipt", async () => {
  h.params = { id: transaction.id };
  const uncategorized = { ...transaction, category: null, categoryId: null };
  h.api.getFinanceTransaction.mockResolvedValue({ data: uncategorized });
  h.api.getFinanceReviewQueue.mockResolvedValue([
    { id: "review", reason: "unknown_merchant", transaction: uncategorized },
  ]);
  const saved = {
    ...transaction,
    category: "Travel",
    categoryId: "travel",
    updatedAt: "2026-11-09T12:00:00Z",
  };
  h.api.resolveFinanceReview.mockImplementation(async () => {
    h.api.getFinanceTransaction.mockResolvedValue({ data: saved });
    h.api.getFinanceReviewQueue.mockResolvedValue([]);
    return { applied: true, transaction: saved };
  });
  mount(<FinanceTransactionScreen />);
  await screen.findByText("Uncategorized");
  fireEvent.click(screen.getByRole("button", { name: /^Category/ }));
  fireEvent.click(await screen.findByRole("button", { name: "Travel" }));
  await waitFor(() =>
    expect(h.api.resolveFinanceReview).toHaveBeenCalledWith("review", {
      action: "recategorize",
      categoryId: "travel",
      expectedTransactionUpdatedAt: transaction.updatedAt,
      learnMerchant: "never",
      rationale: null,
    }),
  );
  await waitFor(() => expect(screen.queryByText("Uncategorized")).toBeNull());
  expect(screen.getByRole("button", { name: /Category.*Travel/ })).toBeTruthy();
  expect(h.push).not.toHaveBeenCalled();
});
it("keeps category attention after an unconfirmed approval", async () => {
  h.params = { id: transaction.id };
  h.api.getFinanceTransaction.mockResolvedValue({ data: { ...transaction, category: null } });
  h.api.getFinanceReviewQueue.mockResolvedValue([
    {
      id: "review",
      reason: "low_confidence",
      transaction,
      suggestedCategory: { id: "travel", name: "Travel" },
    },
  ]);
  h.api.resolveFinanceReview.mockResolvedValue({ applied: false, transaction: null });
  mount(<FinanceTransactionScreen />);
  fireEvent.click(await screen.findByRole("button", { name: "Approve category" }));
  await waitFor(() =>
    expect(h.info).toHaveBeenCalledWith("This transaction still needs review", expect.anything()),
  );
  expect(screen.getByRole("button", { name: /Category.*Travel/ })).toBeTruthy();
});

it("uses category identities on transaction rows and picker options", async () => {
  h.params = { mode: "Transactions" };
  const view = mount(<FinanceSpendingScreen />);
  const row = await screen.findByRole("button", { name: /Corner market/ });
  expect(row.querySelector('[data-icon="categoryGroceryCart"]')).toBeTruthy();
  view.unmount();
  h.params = { id: transaction.id };
  mount(<FinanceTransactionScreen />);
  fireEvent.click(await screen.findByRole("button", { name: /^Category/ }));
  const travel = await screen.findByRole("button", { name: "Travel" });
  expect(travel.querySelector('[data-icon="categoryTravel"]')).toBeTruthy();
});
it("edits the monthly limit inline and stays on category details", async () => {
  h.params = { id: categoryBudget.id, month: categoryBudget.month };
  h.api.getFinanceBudgetStatus.mockResolvedValue([
    { budget: categoryBudget, spent: 42, remaining: 558 },
  ]);
  h.api.createFinanceBudget.mockResolvedValue({ ...categoryBudget, limit: 700 });
  mount(<FinanceBudgetCategoryScreen />);
  fireEvent.click(await screen.findByText("Monthly limit"));
  fireEvent.change(screen.getByLabelText("Monthly budget limit"), { target: { value: "700" } });
  fireEvent.click(screen.getByRole("button", { name: "Save budget limit" }));
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Budget limit updated", expect.anything()),
  );
  expect(h.back).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("Monthly budget limit")).toBeNull();
});
it("saves an inline transaction note with its original revision and no category mutation", async () => {
  h.params = { id: transaction.id };
  h.api.updateFinanceTransaction.mockResolvedValue({ ...transaction, notes: "Gift for Maya" });
  mount(<FinanceTransactionScreen />);
  fireEvent.click(await screen.findByRole("button", { name: /Notes.*Add a note/ }));
  fireEvent.change(screen.getByLabelText("Transaction note"), {
    target: { value: "Gift for Maya" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  await waitFor(() =>
    expect(h.api.updateFinanceTransaction).toHaveBeenCalledWith(transaction.id, {
      notes: "Gift for Maya",
      expectedTransactionUpdatedAt: transaction.updatedAt,
    }),
  );
  expect(h.push).not.toHaveBeenCalled();
  expect(h.success).toHaveBeenCalledWith("Note updated", expect.anything());
});
it("retains the inline note on a failed save", async () => {
  h.params = { id: transaction.id };
  h.api.updateFinanceTransaction.mockRejectedValue(new Error("offline"));
  mount(<FinanceTransactionScreen />);
  fireEvent.click(await screen.findByRole("button", { name: /Notes.*Add a note/ }));
  fireEvent.change(screen.getByLabelText("Transaction note"), { target: { value: "Keep this" } });
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(screen.getByLabelText("Transaction note")).toHaveProperty("value", "Keep this");
});
it("updates planning directly with an idempotent account mutation", async () => {
  const { FinanceAccountScreen } = await import("./details");
  h.params = { id: account.id };
  h.api.updateFinanceAccount.mockResolvedValue({
    outcome: "completed",
    data: { ...account, includeInPlanning: false },
  });
  mount(<FinanceAccountScreen />);
  fireEvent.click(await screen.findByRole("button", { name: /Planning.*Included/ }));
  fireEvent.click(screen.getByRole("button", { name: "Excluded" }));
  await waitFor(() =>
    expect(h.api.updateFinanceAccount).toHaveBeenCalledWith(
      account.id,
      expect.objectContaining({ includeInPlanning: false, idempotencyKey: expect.any(String) }),
    ),
  );
  expect(h.success).toHaveBeenCalledWith("Account updated", expect.anything());
});
it("requires an explicit valid joint ownership share and reports failed outcomes honestly", async () => {
  const { FinanceAccountScreen } = await import("./details");
  h.params = { id: account.id };
  h.api.updateFinanceAccount.mockResolvedValue({
    outcome: "failed",
    communication: { headline: "Account changed elsewhere" },
  });
  mount(<FinanceAccountScreen />);
  fireEvent.click(await screen.findByRole("button", { name: /Ownership/ }));
  fireEvent.click(screen.getByRole("button", { name: "Joint" }));
  fireEvent.change(screen.getByLabelText("Ownership percentage"), { target: { value: "150" } });
  expect(screen.getByRole("button", { name: "Save ownership" })).toHaveProperty("disabled", true);
  fireEvent.change(screen.getByLabelText("Ownership percentage"), { target: { value: "50" } });
  fireEvent.click(screen.getByRole("button", { name: "Save ownership" }));
  await waitFor(() =>
    expect(h.api.updateFinanceAccount).toHaveBeenCalledWith(
      account.id,
      expect.objectContaining({ ownershipType: "joint", ownershipShare: 0.5 }),
    ),
  );
  expect(h.error).toHaveBeenCalledWith("Account changed elsewhere", expect.anything());
  expect(h.success).not.toHaveBeenCalled();
});

it("retries an uncertain account change with the same idempotency key", async () => {
  const { FinanceAccountScreen } = await import("./details");
  h.params = { id: account.id };
  h.api.updateFinanceAccount
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ outcome: "completed", data: account });
  mount(<FinanceAccountScreen />);
  fireEvent.click(await screen.findByRole("button", { name: /Planning.*Included/ }));
  fireEvent.click(screen.getByRole("button", { name: "Excluded" }));
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  const first = h.api.updateFinanceAccount.mock.calls[0][1];
  fireEvent.click(screen.getByRole("button", { name: /Planning.*Included/ }));
  fireEvent.click(screen.getByRole("button", { name: "Excluded" }));
  await waitFor(() => expect(h.api.updateFinanceAccount).toHaveBeenCalledTimes(2));
  expect(h.api.updateFinanceAccount.mock.calls[1][1]).toEqual(first);
});
it("locks an inline note submitted for review without claiming it saved", async () => {
  h.params = { id: transaction.id };
  h.api.updateFinanceTransaction.mockResolvedValue({ status: "pending_review" });
  mount(<FinanceTransactionScreen />);
  fireEvent.click(await screen.findByRole("button", { name: /Notes.*Add a note/ }));
  fireEvent.change(screen.getByLabelText("Transaction note"), {
    target: { value: "Review this note" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save note" }));
  await waitFor(() =>
    expect(h.info).toHaveBeenCalledWith(
      "Submitted for review. The note has not changed.",
      expect.anything(),
    ),
  );
  expect(h.success).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Save note" })).toHaveProperty("disabled", true);
  expect(screen.getByLabelText("Transaction note")).toHaveProperty("value", "Review this note");
});

it("shows saved recurring categories and sorts Coming next by date", async () => {
  h.api.listFinanceRecurringObligations.mockResolvedValue([{ id: "sub", kind: "subscription" }]);
  h.api.listFinanceRecurringOccurrences.mockResolvedValue({
    occurrences: [
      {
        key: "pay",
        displayName: "Payday",
        localDate: "2026-11-15",
        source: { kind: "income", id: "pay" },
        inCurrentSchedule: true,
        matchState: "expected",
        remainingExpectedCents: 200000,
        currencyCode: "USD",
      },
      {
        key: "sub",
        displayName: "Music plan",
        localDate: "2026-11-10",
        source: { kind: "obligation", id: "sub" },
        inCurrentSchedule: true,
        matchState: "expected",
        remainingExpectedCents: 999,
        currencyCode: "USD",
      },
    ],
    unavailableSources: [],
  });
  mount(<FinanceOverviewScreen />);
  await screen.findByText("Nov 10 · Subscription · expected");
  expect(screen.getByText("Nov 15 · Income · expected")).toBeTruthy();
  expect(
    screen.getByText("Music plan").compareDocumentPosition(screen.getByText("Payday")) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it("builds Today from owner-scoped live reads and opens canonical details", async () => {
  const dueAt = new Date(Date.now() - 60_000).toISOString();
  h.api.listTaskWorkspace.mockImplementation(async (query) => ({
    items:
      query.view === "upcoming"
        ? []
        : [
            {
              kind: "task",
              record: { id: "live-task", title: "Send the proposal", dueAt, priority: "high" },
              readOnly: false,
            },
          ],
    total: query.view === "upcoming" ? 0 : 7,
    nextCursor: null,
  }));
  const view = mount(<TodayHome />);
  expect(await screen.findByText("Send the proposal")).toBeTruthy();
  expect(screen.getByText("7 to-do")).toBeTruthy();
  expect(screen.getByText("Overdue · High priority")).toBeTruthy();
  expect(h.api.listTaskWorkspace).toHaveBeenCalledWith({
    view: "today",
    status: "open",
    sort: "auto",
    limit: 3,
  });
  expect(h.api.listFinanceActivity).toHaveBeenCalledWith(
    expect.objectContaining({ actor: "agent", type: "financial_action" }),
  );
  expect(
    view.client
      .getQueryCache()
      .getAll()
      .every((query) => query.queryKey[1] === "owner-a"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: /Send the proposal/ }));
  expect(h.push).toHaveBeenCalledWith({
    pathname: "/task-editor",
    params: { id: "live-task", kind: "task", readOnly: "0" },
  });
  expect(screen.queryByText("sample day")).toBeNull();
});
it("Today shows only confirmed agent work and keeps partial failures honest", async () => {
  const entry = {
    id: "applied",
    kind: "financial_action",
    actor: { type: "agent" },
    status: "applied",
    action: "categorize",
    explanation: "Categorized a saved transaction",
    targets: [{ kind: "transaction", id: "saved" }],
    occurredAt: new Date().toISOString(),
  };
  h.api.listFinanceActivity.mockResolvedValue({
    entries: [
      entry,
      { ...entry, id: "human", actor: { type: "user" }, explanation: "Human work" },
      { ...entry, id: "pending", status: "proposed", explanation: "Not done" },
    ],
    nextCursor: null,
  });
  h.api.listTaskWorkspace.mockRejectedValue(new Error("Offline"));
  mount(<TodayHome />);
  expect(await screen.findByText("Categorized a saved transaction")).toBeTruthy();
  expect(screen.queryByText("Human work")).toBeNull();
  expect(screen.queryByText("Not done")).toBeNull();
  expect(screen.queryByText("Nothing needs your attention right now.")).toBeNull();
  expect(await screen.findByText("To-do unavailable")).toBeTruthy();
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Some of Today couldn’t refresh.",
      expect.objectContaining({ action: expect.any(Object) }),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: /Categorized a saved transaction/ }));
  expect(h.push).toHaveBeenCalledWith({
    pathname: "/finance-transaction",
    params: { id: "saved" },
  });
});
it("Today requires the user's timezone before reading date-scoped records", async () => {
  h.timezone = undefined;
  mount(<TodayHome />);
  expect(screen.getByText("Set your timezone")).toBeTruthy();
  expect(h.api.listTaskWorkspace).not.toHaveBeenCalled();
  expect(h.api.listFinanceRecurringOccurrences).not.toHaveBeenCalled();
});
it("Today gives descriptions the width below the heading and value", async () => {
  h.api.getFinanceReviewQueue.mockResolvedValue([{ status: "open", transaction }]);
  mount(<TodayHome />);
  const description = await screen.findByText(transaction.merchant);
  const value = screen.getByText("Review");
  expect(description.parentElement).toBe(value.parentElement?.parentElement);
});

it("Today merges scheduled work and expected payments chronologically, excluding settled payments", async () => {
  h.timezone = "UTC";
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  h.api.listTaskWorkspace.mockImplementation(async (query) => ({
    items:
      query.view === "upcoming"
        ? [
            {
              kind: "reminder",
              record: { id: "scheduled", title: "Prepare presentation", dueAt: null },
              relevantAt: `${tomorrow}T15:00:00Z`,
              readOnly: false,
            },
          ]
        : [],
    total: 0,
    nextCursor: null,
  }));
  const occurrence = {
    key: "rent",
    displayName: "Apartment rent",
    source: { kind: "obligation", id: "rent-source" },
    localDate: tomorrow,
    remainingExpectedCents: 280000,
    currencyCode: "USD",
    matchState: "expected",
    inCurrentSchedule: true,
  };
  h.api.listFinanceRecurringOccurrences.mockResolvedValue({
    occurrences: [
      occurrence,
      { ...occurrence, key: "paid", displayName: "Already paid", matchState: "matched" },
    ],
    unavailableSources: [],
  });
  mount(<TodayHome />);
  expect(await screen.findByText("Prepare presentation")).toBeTruthy();
  expect(screen.queryByText("Already paid")).toBeNull();
  expect(screen.getByText("−$2,800.00")).toBeTruthy();
  const names = screen.getAllByRole("button").map((button) => button.textContent ?? "");
  expect(names.findIndex((name) => name.includes("Apartment rent"))).toBeLessThan(
    names.findIndex((name) => name.includes("Prepare presentation")),
  );
  fireEvent.click(screen.getByRole("button", { name: /Prepare presentation/ }));
  expect(h.push).toHaveBeenCalledWith({
    pathname: "/task-editor",
    params: { id: "scheduled", kind: "reminder", readOnly: "0" },
  });
});
it("Today routes budget exceptions directly to their category and respects missing payment coverage", async () => {
  h.api.getFinanceBudgetStatus.mockResolvedValue([
    {
      budget: { id: "dining-limit", category: "Dining", month: "2026-11", limit: 100 },
      spent: 125,
    },
  ]);
  h.api.listFinanceRecurringOccurrences.mockResolvedValue({
    occurrences: [],
    unavailableSources: [{ id: "missing" }],
  });
  mount(<TodayHome />);
  expect(await screen.findByText("$25.00 over")).toBeTruthy();
  expect(screen.getByText("Payment data incomplete")).toBeTruthy();
  expect(screen.queryByText("0 payments")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Dining/ }));
  expect(h.push).toHaveBeenCalledWith({
    pathname: "/finance-budget-category",
    params: { id: "dining-limit", month: "2026-11" },
  });
});
