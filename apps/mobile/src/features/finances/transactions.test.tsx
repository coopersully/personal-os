// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PropsWithChildren, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FinanceAccountScreen, FinanceTransactionScreen } from "./details";
import { FinanceSpendingScreen, Transactions } from "./spending";
import { FinanceTransactionEditor } from "./transaction-editor";

vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("@tanstack/react-query", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/apps/web/package.json`)("@tanstack/react-query");
});
const h = vi.hoisted(() => ({
  owner: "owner-a",
  timezone: "America/New_York" as string | undefined,
  params: {} as Record<string, string>,
  push: vi.fn(),
  navigate: vi.fn(),
  setParams: vi.fn(),
  back: vi.fn(),
  alert: vi.fn(),
  screen: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  dismiss: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(() => "feedback"),
  api: {
    listFinanceAccounts: vi.fn(),
    listFinanceTransactions: vi.fn(),
    getFinanceTransaction: vi.fn(),
    getFinanceCategories: vi.fn(),
    getFinanceReviewQueue: vi.fn(),
    getFinanceSpending: vi.fn(),
    getWorkspaceSettings: vi.fn(),
    createFinanceTransaction: vi.fn(),
    updateFinanceTransaction: vi.fn(),
    removeFinanceTransaction: vi.fn(),
    createFinanceCategory: vi.fn(),
    applyFinanceCategorizations: vi.fn(),
  },
}));
vi.mock("react-native", () => {
  const Box = ({ children, testID }: PropsWithChildren<{ testID?: string }>) => (
    <div data-testid={testID}>{children}</div>
  );
  return {
    StyleSheet: { create: (value: unknown) => value },
    AppState: { currentState: "active", addEventListener: () => ({ remove: vi.fn() }) },
    Keyboard: { addListener: () => ({ remove: vi.fn() }) },
    useWindowDimensions: () => ({ height: 852, width: 393 }),
    Image: () => null,
    View: Box,
    ScrollView: Box,
    Text: Box,
    // Unlike the native component, a hidden sheet renders nothing, so its options stay out of reach.
    Modal: ({ children, visible = true }: PropsWithChildren<{ visible?: boolean }>) =>
      visible ? <div role="dialog">{children}</div> : null,
    ActivityIndicator: ({ accessibilityLabel }: { accessibilityLabel?: string }) => (
      <span role="progressbar" aria-label={accessibilityLabel} />
    ),
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
      accessibilityState?: { selected?: boolean; checked?: boolean };
    }>) => (
      <button
        type="button"
        aria-label={accessibilityLabel}
        aria-pressed={accessibilityState?.selected ?? accessibilityState?.checked}
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
      onChangeText: (value: string) => void;
      placeholder?: string;
      editable?: boolean;
    }) => (
      <input
        aria-label={accessibilityLabel}
        placeholder={placeholder}
        disabled={!editable}
        value={value}
        onChange={(event) => onChangeText(event.target.value)}
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
vi.mock("../../components/app-toaster", () => ({ AppToaster: () => null }));
vi.mock("./spending-chart", () => ({ SpendingChart: () => null }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("../auth/context", () => ({
  useOptionalAuth: () => null,
  useAuth: () => ({
    state: { user: { id: h.owner, planningTimezone: h.timezone } },
    session: { api: () => h.api, epoch: () => h.owner },
  }),
}));
vi.mock("sonner-native", () => ({ toast: h }));
vi.mock("expo-router", () => ({
  router: h,
  useLocalSearchParams: () => h.params,
  useFocusEffect: () => undefined,
  Stack: {
    Screen: ({
      options,
    }: {
      options: { title?: string; headerLeft?: () => ReactNode; headerRight?: () => ReactNode };
    }) => {
      h.screen(options);
      return (
        <>
          {options.headerLeft?.() ?? null}
          {options.headerRight?.() ?? null}
        </>
      );
    },
  },
}));

const account = {
  id: "manual-1",
  name: "Cash wallet",
  institution: "Cash",
  currencyCode: "USD",
  balance: 240,
  includeInPlanning: true,
  kind: "cash",
  provider: "manual",
  ownershipType: "individual",
  ownershipShare: 1,
  synchronization: null,
  status: "manual",
  accountMask: null,
  lastSyncedAt: null,
  createdAt: "2026-10-01T12:00:00Z",
  updatedAt: "2026-11-01T12:00:00Z",
};
const second = { ...account, id: "manual-2", name: "Petty cash" };
const linked = {
  ...account,
  id: "linked-1",
  name: "Everyday checking",
  provider: "plaid",
  status: "connected",
};
const category = (id: string, name: string) => ({
  id,
  name,
  color: null,
  group: "Living",
  isSystem: true,
  slug: id,
});
const categories = [
  category("c-groceries", "Groceries"),
  category("c-rent", "RENT_AND_UTILITIES"),
  category("c-travel", "Travel"),
];
const transaction = {
  id: "t-1",
  accountId: account.id,
  amount: 12.5,
  category: "Groceries",
  categoryId: "c-groceries",
  categoryConfidence: 1,
  createdAt: "2026-11-10T12:00:00.000Z",
  currencyCode: "USD",
  date: "2026-11-10",
  direction: "expense",
  merchant: "Corner market",
  needsReview: false,
  notes: null,
  pending: false,
  updatedAt: "2026-11-10T12:00:00.000Z",
};
const other = {
  ...transaction,
  id: "t-2",
  merchant: "Harbor cafe",
  amount: 4,
  category: null,
  categoryId: null,
  needsReview: true,
  updatedAt: "2026-11-11T09:30:00.000Z",
};
const rejection = (status: number) =>
  new ApiClientError({ code: "error", message: "rejected", status });
const accounts = (list: unknown[]) => ({
  accounts: list,
  totals: { cash: 0, netWorth: 0, debt: 0, investments: 0, otherAssets: 0 },
  accountSemantics: {
    possibleDuplicateGroups: [],
    unresolvedOwnershipAccountIds: [],
    excludedAccountIds: [],
    trustworthy: true,
  },
});
const applied = (item: { id: string }) => ({
  applied: true,
  error: null,
  replayed: false,
  status: "applied",
  threshold: null,
  transaction: item,
  transactionId: item.id,
});
function mount(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}
/** Presses a button of the most recent native confirmation. */
function confirm(label: string) {
  const buttons = h.alert.mock.calls.at(-1)?.[2] as { text: string; onPress?: () => void }[];
  act(() => buttons.find((button) => button.text === label)?.onPress?.());
}
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
/** Chooses an option in the sheet or menu that is open. */
const choose = (name: string | RegExp) =>
  fireEvent.click(
    within(screen.getAllByRole("dialog").at(-1) as HTMLElement).getByRole("button", { name }),
  );
const save = () => screen.getByRole("button", { name: "Add transaction" });
/** Action results are Sonner-only: no rendered copy may repeat a toast message. */
function expectNoInlineResult() {
  for (const toast of [h.error, h.success, h.info])
    for (const [message] of toast.mock.calls)
      expect(screen.queryByText(String(message))).toBeNull();
}
/** Opens the header's action menu, which holds the actions when there are several. */
const openActions = async (label = "Transaction actions") =>
  fireEvent.click(await screen.findByRole("button", { name: label }));
const removeAction = async () => {
  await openActions();
  press("Remove transaction");
};
/** Chooses from a sheet whose options arrive with a read. */
const chooseLoaded = async (name: string) =>
  fireEvent.click(await screen.findByRole("button", { name }));
async function fillNewTransaction() {
  mount(<FinanceTransactionEditor />);
  await screen.findByLabelText("Merchant");
  type("Merchant", "  Corner bakery ");
  type("Amount", "8.40");
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of Object.values(h.api)) mock.mockReset();
  h.owner = "owner-a";
  h.timezone = "America/New_York";
  h.params = {};
  h.api.listFinanceAccounts.mockResolvedValue(accounts([account, linked]));
  h.api.listFinanceTransactions.mockResolvedValue({
    items: [transaction, other],
    nextCursor: null,
  });
  h.api.getFinanceCategories.mockResolvedValue(categories);
  h.api.getFinanceReviewQueue.mockResolvedValue([]);
  h.api.getFinanceTransaction.mockResolvedValue({ data: transaction });
  h.api.getFinanceSpending.mockReturnValue(new Promise(() => undefined));
  h.api.getWorkspaceSettings.mockImplementation(async (workspace: string) => ({
    workspace,
    revision: 1,
    preferences: workspace === "calendar" ? { weekStartsOn: "monday" } : {},
  }));
});
afterEach(cleanup);

// Adding a manual transaction

it("opens the new transaction form from Summary, the Transactions action row and a manual account", async () => {
  // Summary offers Add as a command above its content, while the spending read is still loading.
  const summary = mount(<FinanceSpendingScreen />);
  const first = screen.getByRole("button", { name: "Add transaction" });
  expect(first.querySelector('[data-icon="add"]')).toBeNull();
  fireEvent.click(first);
  expect(h.push).toHaveBeenLastCalledWith("/finance-transaction-edit");
  summary.unmount();
  h.push.mockClear();
  h.params = { mode: "Transactions" };
  const view = mount(<FinanceSpendingScreen />);
  // The list waits for the saved Spending defaults, which decide its period.
  const select = await screen.findByRole("button", { name: "Select transactions" });
  const add = screen.getByRole("button", { name: "Add transaction" });
  // Add sits in the same line of commands as Select and Filters, not over the list.
  expect(add.parentElement).toBe(select.parentElement);
  expect(add.querySelector('[data-icon="add"]')).toBeNull();
  fireEvent.click(add);
  expect(h.push).toHaveBeenCalledWith("/finance-transaction-edit");
  view.unmount();
  h.params = { id: account.id };
  mount(<FinanceAccountScreen />);
  await openActions("Account actions");
  press("Add transaction");
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/finance-transaction-edit",
    params: { accountId: account.id },
  });
});

it("keeps Add on Transactions when the spending period cannot be read", () => {
  h.timezone = undefined;
  h.params = { mode: "Transactions" };
  mount(<FinanceSpendingScreen />);
  expect(screen.queryByRole("button", { name: "Select transactions" })).toBeNull();
  press("Add transaction");
  expect(h.push).toHaveBeenCalledWith("/finance-transaction-edit");
});

it("does not offer adding a transaction to a connected account", async () => {
  h.params = { id: linked.id };
  mount(<FinanceAccountScreen />);
  await openActions("Account actions");
  expect(screen.getByRole("button", { name: "Edit account" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Add transaction" })).toBeNull();
});

it("adds a manual transaction once its required fields are valid", async () => {
  h.api.createFinanceTransaction.mockResolvedValue({ ...transaction, id: "t-new" });
  await fillNewTransaction();
  expect(save()).toHaveProperty("disabled", false);
  type("Amount", "0");
  // An invalid amount says what to correct and blocks the save.
  expect(screen.getByText("Enter an amount above zero, such as 12.50.")).toBeTruthy();
  expect(save()).toHaveProperty("disabled", true);
  type("Amount", "8.40");
  type("Date (ISO date/time)", "");
  expect(save()).toHaveProperty("disabled", true);
  type("Date (ISO date/time)", "2026-11-03");
  press("Type, Expense");
  choose("Income");
  type("Notes", " Refund for the cake ");
  fireEvent.click(save());
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Transaction added", { id: "feedback" }),
  );
  // The only manual account is the account; the connected one is never a choice.
  expect(h.api.createFinanceTransaction).toHaveBeenCalledWith({
    accountId: account.id,
    amount: 8.4,
    category: null,
    categoryConfidence: null,
    date: "2026-11-03",
    direction: "income",
    merchant: "Corner bakery",
    notes: "Refund for the cake",
  });
  expect(h.api.createFinanceTransaction).toHaveBeenCalledOnce();
  expect(h.loading).toHaveBeenCalledOnce();
  expect(h.back).toHaveBeenCalledOnce();
  expectNoInlineResult();
});

it("defaults the date to today in the planning timezone and asks which manual account", async () => {
  h.api.listFinanceAccounts.mockResolvedValue(accounts([account, second, linked]));
  h.api.createFinanceTransaction.mockResolvedValue(transaction);
  await fillNewTransaction();
  expect(screen.getByLabelText("Date (ISO date/time)")).toHaveProperty(
    "value",
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date()),
  );
  // With two manual accounts nothing is assumed, and the connected account is not offered.
  expect(save()).toHaveProperty("disabled", true);
  press("Account, Choose");
  expect(
    within(screen.getAllByRole("dialog").at(-1) as HTMLElement).queryByText(linked.name),
  ).toBeNull();
  choose("Petty cash");
  fireEvent.click(save());
  await waitFor(() => expect(h.success).toHaveBeenCalled());
  expect(h.api.createFinanceTransaction).toHaveBeenCalledWith(
    expect.objectContaining({ accountId: second.id }),
  );
});

it("preselects the manual account the form was opened from", async () => {
  h.api.listFinanceAccounts.mockResolvedValue(accounts([account, second]));
  h.params = { accountId: second.id };
  mount(<FinanceTransactionEditor />);
  expect(await screen.findByRole("button", { name: "Account, Petty cash" })).toBeTruthy();
});

it("explains that a manual account is needed instead of offering a form that would be rejected", async () => {
  h.api.listFinanceAccounts.mockResolvedValue(accounts([linked]));
  mount(<FinanceTransactionEditor />);
  expect(await screen.findByText(/belongs to a manual account/)).toBeTruthy();
  expect(screen.queryByLabelText("Merchant")).toBeNull();
  expect(save()).toHaveProperty("disabled", true);
});

it("does not show the empty-account explanation while accounts are loading or failed", async () => {
  h.api.listFinanceAccounts.mockReturnValue(new Promise(() => undefined));
  const view = mount(<FinanceTransactionEditor />);
  expect(screen.getByRole("progressbar")).toBeTruthy();
  expect(screen.queryByText(/belongs to a manual account/)).toBeNull();
  view.unmount();
  h.api.listFinanceAccounts.mockRejectedValue(new Error("offline"));
  mount(<FinanceTransactionEditor />);
  await screen.findByRole("button", { name: /Retry loading/ });
  expect(screen.queryByText(/belongs to a manual account/)).toBeNull();
});

it("checks the account before retrying an unconfirmed add and never writes twice", async () => {
  h.api.createFinanceTransaction.mockRejectedValue(new Error("timeout"));
  await fillNewTransaction();
  type("Date (ISO date/time)", "2026-11-03");
  fireEvent.click(save());
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      expect.stringContaining("Couldn’t confirm the transaction was added."),
      { id: "feedback" },
    ),
  );
  expect(h.back).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Merchant")).toHaveProperty("value", "  Corner bakery ");
  // The earlier attempt did reach the ledger.
  h.api.listFinanceTransactions.mockResolvedValue({
    items: [
      { ...transaction, id: "t-new", merchant: "corner bakery", amount: 8.4, date: "2026-11-03" },
    ],
    nextCursor: null,
  });
  fireEvent.click(save());
  await waitFor(() =>
    expect(h.info).toHaveBeenCalledWith(
      expect.stringContaining("already recorded on that account and date"),
      { id: "feedback" },
    ),
  );
  expect(h.api.listFinanceTransactions).toHaveBeenLastCalledWith(
    expect.objectContaining({ accountId: account.id, from: "2026-11-03", to: "2026-11-03" }),
  );
  expect(h.api.createFinanceTransaction).toHaveBeenCalledOnce();
  expect(h.back).toHaveBeenCalledOnce();
  expectNoInlineResult();
});

it("writes again after an unconfirmed add that left no record, and stops if it cannot check", async () => {
  h.api.createFinanceTransaction.mockRejectedValueOnce(rejection(503));
  await fillNewTransaction();
  fireEvent.click(save());
  await waitFor(() => expect(h.error).toHaveBeenCalledOnce());
  h.api.listFinanceTransactions.mockRejectedValueOnce(new Error("offline"));
  fireEvent.click(save());
  await waitFor(() =>
    expect(h.error).toHaveBeenLastCalledWith(
      "Couldn’t check whether the transaction was added. Try again shortly.",
      { id: "feedback" },
    ),
  );
  expect(h.api.createFinanceTransaction).toHaveBeenCalledOnce();
  h.api.listFinanceTransactions.mockResolvedValue({ items: [transaction], nextCursor: null });
  h.api.createFinanceTransaction.mockResolvedValue(transaction);
  fireEvent.click(save());
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Transaction added", expect.anything()),
  );
  expect(h.api.createFinanceTransaction).toHaveBeenCalledTimes(2);
});

it("retries a definitively rejected add without a lookup", async () => {
  h.api.createFinanceTransaction.mockRejectedValueOnce(rejection(422));
  await fillNewTransaction();
  fireEvent.click(save());
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Couldn’t add this transaction. Your draft is still here.",
      { id: "feedback" },
    ),
  );
  h.api.createFinanceTransaction.mockResolvedValue(transaction);
  fireEvent.click(save());
  await waitFor(() => expect(h.success).toHaveBeenCalled());
  // Only the refresh after success reads the list.
  expect(
    h.api.listFinanceTransactions.mock.calls.filter(
      ([query]) => query.from === query.to && query.from,
    ),
  ).toHaveLength(0);
});

it.each([
  ["pending_review", "Submitted for review. The transaction has not been added."],
  ["needs_input", "More input is needed. The transaction has not been added."],
])("reports a %s add as not applied and does not close", async (status, message) => {
  h.api.createFinanceTransaction.mockResolvedValue({ status });
  await fillNewTransaction();
  fireEvent.click(save());
  await waitFor(() => expect(h.info).toHaveBeenCalledWith(message, { id: "feedback" }));
  expect(h.success).not.toHaveBeenCalled();
  expect(h.back).not.toHaveBeenCalled();
  // The submitted draft cannot be sent a second time.
  expect(save()).toHaveProperty("disabled", true);
  expectNoInlineResult();
});

it("asks before discarding an edited new transaction", async () => {
  await fillNewTransaction();
  press("Cancel");
  expect(h.alert).toHaveBeenCalledWith(
    "Discard this transaction?",
    expect.any(String),
    expect.any(Array),
  );
  expect(h.back).not.toHaveBeenCalled();
  confirm("Discard");
  expect(h.back).toHaveBeenCalledOnce();
  expect(h.api.createFinanceTransaction).not.toHaveBeenCalled();
});

// Categories

it("shows a provider-coded category as words and still saves its stored name", async () => {
  h.params = { id: transaction.id };
  h.api.updateFinanceTransaction.mockResolvedValue({
    ...transaction,
    category: "RENT_AND_UTILITIES",
  });
  mount(<FinanceTransactionEditor />);
  fireEvent.click(await screen.findByRole("button", { name: /^Category/ }));
  expect(screen.queryByText("RENT_AND_UTILITIES")).toBeNull();
  choose("Rent And Utilities");
  expect(screen.getByRole("button", { name: /Category.*Rent And Utilities/ })).toBeTruthy();
  press("Save changes");
  await waitFor(() => expect(h.success).toHaveBeenCalled());
  expect(h.api.updateFinanceTransaction).toHaveBeenCalledWith(transaction.id, {
    category: "RENT_AND_UTILITIES",
    expectedTransactionUpdatedAt: transaction.updatedAt,
  });
});

it("shows a provider-coded category as words on the transaction and in its list row", async () => {
  const coded = { ...transaction, category: "RENT_AND_UTILITIES", categoryId: "c-rent" };
  h.api.getFinanceTransaction.mockResolvedValue({ data: coded });
  h.api.listFinanceTransactions.mockResolvedValue({ items: [coded], nextCursor: null });
  h.params = { id: transaction.id };
  const view = mount(<FinanceTransactionScreen />);
  expect(await screen.findByRole("button", { name: /Category.*Rent And Utilities/ })).toBeTruthy();
  view.unmount();
  mount(<Transactions />);
  expect(await screen.findByRole("button", { name: /Rent And Utilities/ })).toBeTruthy();
  expect(screen.queryByText(/RENT_AND_UTILITIES/)).toBeNull();
});

it("creates a category from the editor and selects it for the transaction", async () => {
  h.params = { id: transaction.id };
  const created = category("c-pets", "Pet care");
  h.api.createFinanceCategory.mockResolvedValue(created);
  h.api.updateFinanceTransaction.mockResolvedValue({ ...transaction, category: "Pet care" });
  mount(<FinanceTransactionEditor />);
  fireEvent.click(await screen.findByRole("button", { name: "New category" }));
  expect(screen.getByRole("button", { name: "Add category" })).toHaveProperty("disabled", true);
  type("New category name", "  Pet care ");
  press("Add category");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Category “Pet care” added", { id: "feedback" }),
  );
  expect(h.api.createFinanceCategory).toHaveBeenCalledWith({ name: "Pet care" });
  expect(screen.getByRole("button", { name: /Category.*Pet care/ })).toBeTruthy();
  // Creating a category does not save the transaction; Save does, with the original revision.
  expect(h.api.updateFinanceTransaction).not.toHaveBeenCalled();
  press("Save changes");
  await waitFor(() => expect(h.api.updateFinanceTransaction).toHaveBeenCalled());
  expect(h.api.updateFinanceTransaction).toHaveBeenCalledWith(transaction.id, {
    category: "Pet care",
    expectedTransactionUpdatedAt: transaction.updatedAt,
  });
  expectNoInlineResult();
});

it("selects an existing category instead of creating it again", async () => {
  await fillNewTransaction();
  press("New category");
  type("New category name", "travel");
  press("Add category");
  expect(h.api.createFinanceCategory).not.toHaveBeenCalled();
  expect(h.info).toHaveBeenCalledWith("“Travel” already exists. It is now selected.");
  expect(screen.getByRole("button", { name: /Category.*Travel/ })).toBeTruthy();
});

it("keeps the typed category name when adding it fails, and says whether a retry is safe", async () => {
  h.api.createFinanceCategory.mockRejectedValueOnce(rejection(422));
  await fillNewTransaction();
  press("New category");
  type("New category name", "Pet care");
  press("Add category");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Couldn’t add this category. Check the name and try again.",
      { id: "feedback" },
    ),
  );
  expect(screen.getByLabelText("New category name")).toHaveProperty("value", "Pet care");
  h.api.createFinanceCategory.mockRejectedValueOnce(new Error("timeout"));
  press("Add category");
  await waitFor(() =>
    expect(h.error).toHaveBeenLastCalledWith(
      expect.stringContaining("Couldn’t confirm the category was added."),
      { id: "feedback" },
    ),
  );
  expect(screen.getByLabelText("New category name")).toHaveProperty("value", "Pet care");
  expect(screen.getByRole("button", { name: /Category.*Chosen by nohmi/ })).toBeTruthy();
  expectNoInlineResult();
});

// Editing guards

it("reports a stale revision when saving an edit and keeps the draft", async () => {
  h.params = { id: transaction.id };
  h.api.updateFinanceTransaction.mockRejectedValue(rejection(409));
  mount(<FinanceTransactionEditor />);
  fireEvent.click(await screen.findByRole("button", { name: /^Category/ }));
  choose("Travel");
  press("Save changes");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(expect.stringContaining("changed elsewhere"), {
      id: "feedback",
    }),
  );
  expect(h.api.updateFinanceTransaction).toHaveBeenCalledWith(
    transaction.id,
    expect.objectContaining({ expectedTransactionUpdatedAt: transaction.updatedAt }),
  );
  expect(h.back).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: /Category.*Travel/ })).toBeTruthy();
  expectNoInlineResult();
});

// Correcting a manual transaction's date

const dateLabel = "Date (ISO date/time)";
const synced = { ...transaction, accountId: linked.id };

it("corrects the date of a manual transaction against the revision it was opened with", async () => {
  h.params = { id: transaction.id };
  h.api.updateFinanceTransaction.mockResolvedValue({ ...transaction, date: "2026-11-02" });
  mount(<FinanceTransactionEditor />);
  expect(await screen.findByLabelText(dateLabel)).toHaveProperty("value", "2026-11-10");
  expect(screen.getByRole("button", { name: "Save changes" })).toHaveProperty("disabled", true);
  type(dateLabel, "");
  expect(screen.getByRole("button", { name: "Save changes" })).toHaveProperty("disabled", true);
  type(dateLabel, "2026-11-02");
  press("Save changes");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Transaction updated", { id: "feedback" }),
  );
  expect(h.api.updateFinanceTransaction).toHaveBeenCalledExactlyOnceWith(transaction.id, {
    date: "2026-11-02",
    expectedTransactionUpdatedAt: transaction.updatedAt,
  });
  expect(h.loading).toHaveBeenCalledExactlyOnceWith("Saving transaction…");
  expect(h.back).toHaveBeenCalledOnce();
  expectNoInlineResult();
});

it("keeps the date of a synced transaction read-only", async () => {
  h.api.getFinanceTransaction.mockResolvedValue({ data: synced });
  h.params = { id: synced.id };
  const view = mount(<FinanceTransactionEditor />);
  await screen.findByRole("button", { name: /^Category/ });
  await waitFor(() => expect(h.api.listFinanceAccounts).toHaveBeenCalled());
  await act(async () => undefined);
  expect(screen.queryByLabelText(dateLabel)).toBeNull();
  view.unmount();
  mount(<FinanceTransactionScreen />);
  await screen.findByText("Everyday checking");
  expect(screen.queryByRole("button", { name: /^Date/ })).toBeNull();
  expect(screen.getByText("Date")).toBeTruthy();
});

it("opens the date for editing from a manual transaction", async () => {
  h.params = { id: transaction.id };
  mount(<FinanceTransactionScreen />);
  fireEvent.click(await screen.findByRole("button", { name: /^Date/ }));
  expect(h.push).toHaveBeenCalledWith({
    pathname: "/finance-transaction-edit",
    params: { id: transaction.id, field: "date" },
  });
});

it("says why a date change was rejected, and when it could not be confirmed", async () => {
  h.params = { id: transaction.id };
  mount(<FinanceTransactionEditor />);
  await screen.findByLabelText(dateLabel);
  type(dateLabel, "2026-11-02");

  h.api.updateFinanceTransaction.mockRejectedValueOnce(rejection(409));
  press("Save changes");
  await waitFor(() =>
    expect(h.error).toHaveBeenLastCalledWith(
      "This transaction changed elsewhere. Close and reopen it to review the latest version; your draft is still here.",
      { id: "feedback" },
    ),
  );

  h.api.updateFinanceTransaction.mockRejectedValueOnce(
    new ApiClientError({
      code: "invalid_request",
      message: "Dates on synced transactions can't be changed.",
      status: 400,
    }),
  );
  press("Save changes");
  await waitFor(() =>
    expect(h.error).toHaveBeenLastCalledWith(
      "Couldn’t save this transaction. Dates on synced transactions can't be changed.",
      { id: "feedback" },
    ),
  );

  h.api.updateFinanceTransaction.mockRejectedValueOnce(rejection(503));
  press("Save changes");
  await waitFor(() =>
    expect(h.error).toHaveBeenLastCalledWith(
      "Couldn’t confirm the save. Your draft is still here. Check the transaction before retrying.",
      { id: "feedback" },
    ),
  );
  expect(h.api.updateFinanceTransaction).toHaveBeenCalledTimes(3);
  expect(h.back).not.toHaveBeenCalled();
  expect(h.success).not.toHaveBeenCalled();
  expect(screen.getByLabelText(dateLabel)).toHaveProperty("value", "2026-11-02");
  expectNoInlineResult();
});

// Removing a manual transaction

it("offers Remove only for a transaction in a manual account", async () => {
  h.params = { id: transaction.id };
  const view = mount(<FinanceTransactionScreen />);
  await openActions();
  expect(screen.getByRole("button", { name: "Remove transaction" })).toBeTruthy();
  view.unmount();
  h.api.getFinanceTransaction.mockResolvedValue({ data: { ...transaction, accountId: linked.id } });
  mount(<FinanceTransactionScreen />);
  await screen.findByText(linked.name);
  await openActions();
  expect(screen.getByRole("button", { name: "Edit transaction" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Remove transaction" })).toBeNull();
});

it("does not offer Remove while the account is unknown", async () => {
  h.api.listFinanceAccounts.mockRejectedValue(new Error("offline"));
  h.params = { id: transaction.id };
  mount(<FinanceTransactionScreen />);
  await openActions();
  expect(screen.getByRole("button", { name: "Edit transaction" })).toBeTruthy();
  await waitFor(() => expect(h.api.listFinanceAccounts).toHaveBeenCalled());
  expect(screen.queryByRole("button", { name: "Remove transaction" })).toBeNull();
});

it("removes a manual transaction only after confirmation", async () => {
  h.api.removeFinanceTransaction.mockResolvedValue({
    outcome: "completed",
    data: { id: transaction.id, removed: true },
    communication: { headline: "Manual transaction removed." },
  });
  h.params = { id: transaction.id };
  mount(<FinanceTransactionScreen />);
  await removeAction();
  expect(h.alert).toHaveBeenCalledWith(
    "Remove Corner market?",
    expect.stringContaining("cannot be undone"),
    expect.any(Array),
  );
  confirm("Keep transaction");
  expect(h.api.removeFinanceTransaction).not.toHaveBeenCalled();
  await removeAction();
  confirm("Remove");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Transaction removed", { id: "feedback" }),
  );
  expect(h.api.removeFinanceTransaction).toHaveBeenCalledWith(transaction.id, {
    idempotencyKey: expect.any(String),
  });
  expect(h.back).toHaveBeenCalledOnce();
  // Lists are re-read; the removed record is not fetched again, which would only fail.
  await waitFor(() => expect(h.api.listFinanceAccounts).toHaveBeenCalledTimes(2));
  expect(h.api.getFinanceTransaction).toHaveBeenCalledOnce();
  expectNoInlineResult();
});

it("keeps the removal key across an unconfirmed result and renews it after a rejection", async () => {
  h.api.removeFinanceTransaction.mockRejectedValueOnce(new Error("timeout"));
  h.params = { id: transaction.id };
  mount(<FinanceTransactionScreen />);
  await removeAction();
  confirm("Remove");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Couldn’t confirm the removal. Check Transactions before trying again.",
      { id: "feedback" },
    ),
  );
  expect(h.back).not.toHaveBeenCalled();
  // Unknown outcome: the record is re-read.
  await waitFor(() => expect(h.api.getFinanceTransaction).toHaveBeenCalledTimes(2));
  h.api.removeFinanceTransaction.mockRejectedValueOnce(rejection(422));
  await removeAction();
  confirm("Remove");
  await waitFor(() =>
    expect(h.error).toHaveBeenLastCalledWith(
      "Couldn’t remove this transaction. It is still recorded.",
      { id: "feedback" },
    ),
  );
  h.api.removeFinanceTransaction.mockResolvedValue({
    outcome: "failed",
    communication: { headline: "This transaction cannot be removed." },
  });
  await removeAction();
  confirm("Remove");
  await waitFor(() =>
    expect(h.error).toHaveBeenLastCalledWith("This transaction cannot be removed.", {
      id: "feedback",
    }),
  );
  const keys = h.api.removeFinanceTransaction.mock.calls.map(([, input]) => input.idempotencyKey);
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).not.toBe(keys[0]);
  expect(h.back).not.toHaveBeenCalled();
  expectNoInlineResult();
});

it("leaves a transaction that was already removed elsewhere", async () => {
  h.api.removeFinanceTransaction.mockRejectedValue(rejection(404));
  h.params = { id: transaction.id };
  mount(<FinanceTransactionScreen />);
  await removeAction();
  confirm("Remove");
  await waitFor(() =>
    expect(h.info).toHaveBeenCalledWith("This transaction was already removed.", {
      id: "feedback",
    }),
  );
  expect(h.back).toHaveBeenCalledOnce();
});

// Filtering and sorting

it("filters by category and review state and sorts on the server", async () => {
  mount(<Transactions accountId={account.id} />);
  await screen.findByRole("button", { name: /Corner market/ });
  expect(h.api.listFinanceTransactions).toHaveBeenLastCalledWith(
    expect.objectContaining({ categoryId: undefined, review: undefined, sortBy: undefined }),
  );
  press("Filters and sort, 0 filters active, sorted by date, newest first");
  fireEvent.click(await screen.findByRole("button", { name: "Category, All categories" }));
  choose("Rent And Utilities");
  await waitFor(() =>
    expect(h.api.listFinanceTransactions).toHaveBeenLastCalledWith(
      expect.objectContaining({ accountId: account.id, categoryId: "c-rent" }),
    ),
  );
  press("Review, Any review state");
  choose("Needs review");
  await waitFor(() =>
    expect(h.api.listFinanceTransactions).toHaveBeenLastCalledWith(
      expect.objectContaining({ categoryId: "c-rent", review: "needs_review" }),
    ),
  );
  press("Sort by, Date");
  choose("Amount");
  await waitFor(() =>
    expect(h.api.listFinanceTransactions).toHaveBeenLastCalledWith(
      expect.objectContaining({ sortBy: "amount", sortDirection: "desc" }),
    ),
  );
  press("Order, Highest first");
  choose("Lowest first");
  await waitFor(() =>
    expect(h.api.listFinanceTransactions).toHaveBeenLastCalledWith(
      expect.objectContaining({ sortBy: "amount", sortDirection: "asc", review: "needs_review" }),
    ),
  );
  press("Done");
  // Each active choice is readable and removable outside the sheet.
  expect(
    screen.getByRole("button", {
      name: "Filters and sort, 2 filters active, sorted by amount, lowest first",
    }),
  ).toBeTruthy();
  press("Category: Rent And Utilities");
  await waitFor(() =>
    expect(h.api.listFinanceTransactions).toHaveBeenLastCalledWith(
      expect.objectContaining({ categoryId: undefined, review: "needs_review" }),
    ),
  );
  press("Needs review");
  press("Sorted by amount, lowest first");
  await waitFor(() =>
    expect(h.api.listFinanceTransactions).toHaveBeenLastCalledWith(
      expect.objectContaining({ review: undefined, sortBy: undefined, sortDirection: undefined }),
    ),
  );
  expect(screen.queryByRole("button", { name: /^Sorted by|^Category:/ })).toBeNull();
});

it("sorts merchants A to Z by default and resets filters without changing the order", async () => {
  mount(<Transactions />);
  await screen.findByRole("button", { name: /Corner market/ });
  press(/^Filters and sort/);
  expect(screen.getByRole("button", { name: "Reset filters" })).toHaveProperty("disabled", true);
  press("Review, Any review state");
  choose("No review needed");
  press("Sort by, Date");
  choose("Merchant");
  await waitFor(() =>
    expect(h.api.listFinanceTransactions).toHaveBeenLastCalledWith(
      expect.objectContaining({ review: "resolved", sortBy: "merchant", sortDirection: "asc" }),
    ),
  );
  press("Reset filters");
  await waitFor(() =>
    expect(h.api.listFinanceTransactions).toHaveBeenLastCalledWith(
      expect.objectContaining({ review: undefined, sortBy: "merchant", sortDirection: "asc" }),
    ),
  );
});

it("omits the category filter in a list already scoped to one budget category", async () => {
  mount(<Transactions budgetId="budget-1" />);
  await screen.findByRole("button", { name: /Corner market/ });
  press(/^Filters and sort/);
  expect(screen.getByRole("button", { name: "Review, Any review state" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^Category,/ })).toBeNull();
  expect(h.api.getFinanceCategories).not.toHaveBeenCalled();
});

it("names a row's review state in its text", async () => {
  mount(<Transactions />);
  const row = await screen.findByRole("button", { name: /Harbor cafe/ });
  expect(row.textContent).toContain("Uncategorized · Needs review");
  expect(screen.getByRole("button", { name: /Corner market/ }).textContent).not.toContain(
    "Needs review",
  );
});

// Categorizing several transactions

async function selectBoth() {
  mount(<Transactions />);
  await screen.findByRole("button", { name: /Corner market/ });
  press("Select transactions");
  expect(screen.getByRole("button", { name: "Categorize 0 selected transactions" })).toHaveProperty(
    "disabled",
    true,
  );
  press(/Corner market/);
  press(/Harbor cafe/);
}
async function categorizeAs(name: string) {
  press("Categorize 2 selected transactions");
  await chooseLoaded(name);
  confirm("Categorize");
}

it("selects rows instead of opening them and states the selection in each row", async () => {
  await selectBoth();
  expect(h.push).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: /Corner market/ }).textContent).toContain("Selected ·");
  press(/Harbor cafe/);
  expect(screen.getByRole("button", { name: /Harbor cafe/ }).textContent).toContain("Not selected");
  expect(screen.getByRole("button", { name: "Categorize 1 selected transaction" })).toBeTruthy();
  press("Cancel selection");
  press(/Corner market/);
  expect(h.push).toHaveBeenCalledWith({
    pathname: "/finance-transaction",
    params: { id: transaction.id },
  });
});

it("categorizes the selected transactions against their displayed revisions", async () => {
  h.api.applyFinanceCategorizations.mockResolvedValue([applied(transaction), applied(other)]);
  await selectBoth();
  await categorizeAs("Travel");
  expect(h.alert).toHaveBeenLastCalledWith(
    "Categorize 2 transactions as Travel?",
    expect.stringContaining("Merchant rules stay unchanged"),
    expect.any(Array),
  );
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("2 transactions categorized as Travel", {
      id: "feedback",
    }),
  );
  expect(h.api.applyFinanceCategorizations).toHaveBeenCalledWith({
    decisions: [transaction, other].map((item) => ({
      transactionId: item.id,
      expectedTransactionUpdatedAt: item.updatedAt,
      categoryId: "c-travel",
      confidence: 1,
      learnMerchant: "never",
      rationale: "Categorized by the user in Transactions.",
    })),
  });
  // The list is re-read and selection mode ends.
  await waitFor(() => expect(h.api.listFinanceTransactions).toHaveBeenCalledTimes(2));
  expect(await screen.findByRole("button", { name: "Select transactions" })).toHaveProperty(
    "disabled",
    false,
  );
  expectNoInlineResult();
});

it("does nothing when the confirmation is cancelled", async () => {
  await selectBoth();
  press("Categorize 2 selected transactions");
  await chooseLoaded("Travel");
  confirm("Cancel");
  expect(h.api.applyFinanceCategorizations).not.toHaveBeenCalled();
  expect(h.loading).not.toHaveBeenCalled();
});

it("reports a stale revision and a review-required record separately from applied ones", async () => {
  h.api.applyFinanceCategorizations.mockResolvedValue([
    applied(transaction),
    {
      ...applied(other),
      applied: false,
      status: "failed",
      transaction: null,
      error: { code: "conflict", message: "changed", requestId: "r" },
    },
  ]);
  await selectBoth();
  await categorizeAs("Travel");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith("1 of 2 categorized as Travel: 1 changed elsewhere.", {
      id: "feedback",
    }),
  );
  expect(h.success).not.toHaveBeenCalled();
  cleanup();
  vi.clearAllMocks();
  h.api.applyFinanceCategorizations.mockResolvedValue([
    applied(transaction),
    { ...applied(other), applied: false, status: "review_required", transaction: null },
  ]);
  await selectBoth();
  await categorizeAs("Travel");
  await waitFor(() =>
    expect(h.info).toHaveBeenCalledWith("1 of 2 categorized as Travel: 1 sent to review.", {
      id: "feedback",
    }),
  );
  expect(h.error).not.toHaveBeenCalled();
});

it.each([
  ["pending_review", "Submitted for review. No categories were changed."],
  ["needs_input", "More input is needed. No categories were changed."],
])("reports a %s categorization as not applied", async (status, message) => {
  h.api.applyFinanceCategorizations.mockResolvedValue({ status });
  await selectBoth();
  await categorizeAs("Travel");
  await waitFor(() => expect(h.info).toHaveBeenCalledWith(message, { id: "feedback" }));
  expect(h.success).not.toHaveBeenCalled();
});

it("requires a successful reload after an unconfirmed categorization before selecting again", async () => {
  h.api.applyFinanceCategorizations.mockRejectedValue(new Error("timeout"));
  await selectBoth();
  h.api.listFinanceTransactions.mockRejectedValue(new Error("offline"));
  await categorizeAs("Travel");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      expect.stringContaining("Couldn’t confirm the categories were saved."),
      { id: "feedback" },
    ),
  );
  // The reload failed: the displayed revisions cannot be trusted for another attempt.
  const reloadRow = await screen.findByRole("button", { name: /Reload transactions/ });
  expect(screen.getByRole("button", { name: "Select transactions" })).toHaveProperty(
    "disabled",
    true,
  );
  h.api.listFinanceTransactions.mockResolvedValue({
    items: [{ ...transaction, updatedAt: "2026-11-12T08:00:00.000Z" }, other],
    nextCursor: null,
  });
  fireEvent.click(reloadRow);
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Transactions reloaded", { id: "feedback" }),
  );
  expect(screen.queryByRole("button", { name: /Reload transactions/ })).toBeNull();
  // A second attempt uses the reloaded revision.
  h.api.applyFinanceCategorizations.mockResolvedValue([applied(transaction)]);
  press("Select transactions");
  press(/Corner market/);
  press("Categorize 1 selected transaction");
  await chooseLoaded("Travel");
  confirm("Categorize");
  await waitFor(() => expect(h.api.applyFinanceCategorizations).toHaveBeenCalledTimes(2));
  expect(h.api.applyFinanceCategorizations.mock.calls[1][0].decisions).toEqual([
    expect.objectContaining({
      transactionId: transaction.id,
      expectedTransactionUpdatedAt: "2026-11-12T08:00:00.000Z",
    }),
  ]);
  expectNoInlineResult();
});

it("reports a definitive rejection as nothing changed", async () => {
  h.api.applyFinanceCategorizations.mockRejectedValue(rejection(422));
  await selectBoth();
  await categorizeAs("Travel");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Couldn’t categorize these transactions. Nothing was changed.",
      { id: "feedback" },
    ),
  );
});

it("does not offer selection while transactions are loading, failed or empty", async () => {
  h.api.listFinanceTransactions.mockReturnValue(new Promise(() => undefined));
  const loading = mount(<Transactions />);
  expect(screen.getByRole("button", { name: "Select transactions" })).toHaveProperty(
    "disabled",
    true,
  );
  loading.unmount();
  h.api.listFinanceTransactions.mockRejectedValue(new Error("offline"));
  const failed = mount(<Transactions />);
  await screen.findByRole("button", { name: /Retry loading/ });
  expect(screen.getByRole("button", { name: "Select transactions" })).toHaveProperty(
    "disabled",
    true,
  );
  failed.unmount();
  h.api.listFinanceTransactions.mockResolvedValue({ items: [], nextCursor: null });
  mount(<Transactions />);
  await screen.findByText("No transactions in this view.");
  expect(screen.getByRole("button", { name: "Select transactions" })).toHaveProperty(
    "disabled",
    true,
  );
});

it("ends a selection when the list changes", async () => {
  await selectBoth();
  type("Search transactions", "coffee");
  await waitFor(() =>
    expect(h.api.listFinanceTransactions).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "coffee" }),
    ),
  );
  expect(await screen.findByRole("button", { name: "Select transactions" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /^Categorize/ })).toBeNull();
});

it("does not offer selection over a previous filter's rows or during the reload after a submission", async () => {
  mount(<Transactions />);
  await screen.findByRole("button", { name: /Corner market/ });
  // A new filter is loading: the rows on screen belong to the previous one.
  h.api.listFinanceTransactions.mockReturnValue(new Promise(() => undefined));
  type("Search transactions", "coffee");
  await screen.findByRole("progressbar", { name: "Updating transactions" });
  expect(screen.getByRole("button", { name: /Corner market/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Select transactions" })).toHaveProperty(
    "disabled",
    true,
  );
  cleanup();
  h.api.listFinanceTransactions.mockResolvedValue({
    items: [transaction, other],
    nextCursor: null,
  });
  h.api.applyFinanceCategorizations.mockResolvedValue([applied(transaction), applied(other)]);
  await selectBoth();
  // The reload after the submission has not answered yet.
  h.api.listFinanceTransactions.mockReturnValue(new Promise(() => undefined));
  await categorizeAs("Travel");
  await waitFor(() => expect(h.success).toHaveBeenCalled());
  expect(screen.getByRole("button", { name: /Corner market/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Select transactions" })).toHaveProperty(
    "disabled",
    true,
  );
});

it("sends a category chosen for a new transaction and can hand the choice back to nohmi", async () => {
  h.api.createFinanceTransaction.mockResolvedValue(transaction);
  await fillNewTransaction();
  press(/Category.*Chosen by nohmi/);
  await chooseLoaded("Rent And Utilities");
  expect(screen.getByRole("button", { name: /Category.*Rent And Utilities/ })).toBeTruthy();
  press(/Category.*Rent And Utilities/);
  await chooseLoaded("Chosen by nohmi");
  press(/Category.*Chosen by nohmi/);
  await chooseLoaded("Travel");
  fireEvent.click(save());
  await waitFor(() => expect(h.success).toHaveBeenCalled());
  expect(h.api.createFinanceTransaction).toHaveBeenCalledWith(
    expect.objectContaining({ category: "Travel" }),
  );
});

it("abandons a new category name without writing", async () => {
  await fillNewTransaction();
  press("New category");
  type("New category name", "Pet care");
  // The inline dismissal is named apart from the form's own Cancel.
  press("Cancel new category");
  expect(screen.queryByLabelText("New category name")).toBeNull();
  expect(screen.getByRole("button", { name: "New category" })).toBeTruthy();
  expect(h.api.createFinanceCategory).not.toHaveBeenCalled();
});

it("reads every page of that day before deciding an earlier add left no record", async () => {
  h.api.createFinanceTransaction.mockRejectedValueOnce(new Error("timeout"));
  await fillNewTransaction();
  type("Date (ISO date/time)", "2026-11-03");
  fireEvent.click(save());
  await waitFor(() => expect(h.error).toHaveBeenCalledOnce());
  h.api.listFinanceTransactions.mockReset();
  h.api.listFinanceTransactions
    .mockResolvedValueOnce({ items: [transaction], nextCursor: "page-2" })
    .mockResolvedValueOnce({
      items: [{ ...transaction, merchant: "Corner bakery", amount: 8.4, date: "2026-11-03" }],
      nextCursor: null,
    })
    .mockResolvedValue({ items: [], nextCursor: null });
  fireEvent.click(save());
  await waitFor(() => expect(h.info).toHaveBeenCalled());
  expect(h.api.listFinanceTransactions.mock.calls[1][0]).toMatchObject({ cursor: "page-2" });
  expect(h.api.createFinanceTransaction).toHaveBeenCalledOnce();
});

it("stops selecting at the server's limit of 100 and says so", async () => {
  const many = Array.from({ length: 101 }, (_, index) => ({
    ...transaction,
    id: `t-${index}`,
    merchant: `Shop ${String(index).padStart(3, "0")}`,
  }));
  h.api.listFinanceTransactions.mockResolvedValue({ items: many, nextCursor: null });
  mount(<Transactions />);
  await screen.findByRole("button", { name: /Shop 000/ });
  press("Select transactions");
  // Rows keep their elements while selection changes, so look them up once.
  const rows = screen.getAllByRole("button").filter((row) => row.textContent?.includes("Shop "));
  expect(rows).toHaveLength(101);
  for (const row of rows) fireEvent.click(row);
  expect(screen.getByRole("button", { name: "Categorize 100 selected transactions" })).toBeTruthy();
  expect(h.info).toHaveBeenCalledWith("Select up to 100 transactions at a time.");
  expect(screen.getByRole("button", { name: /Shop 100/ }).textContent).toContain("Not selected");
}, 30_000);

it("corrects a comma-decimal amount instead of saving a hundred times its value", async () => {
  await fillNewTransaction();
  for (const text of ["12,50", "1,2"]) {
    type("Amount", text);
    expect(screen.getByText("Enter an amount above zero, such as 12.50.")).toBeTruthy();
    expect(save()).toHaveProperty("disabled", true);
  }
  fireEvent.click(save());
  expect(h.api.createFinanceTransaction).not.toHaveBeenCalled();
  h.api.createFinanceTransaction.mockResolvedValue(transaction);
  type("Amount", "1,250.50");
  fireEvent.click(save());
  await waitFor(() => expect(h.success).toHaveBeenCalled());
  expect(h.api.createFinanceTransaction).toHaveBeenCalledWith(
    expect.objectContaining({ amount: 1250.5 }),
  );
});

it("does not claim nothing was added when leaving after an unconfirmed add, and re-reads", async () => {
  h.api.createFinanceTransaction.mockRejectedValue(new Error("timeout"));
  await fillNewTransaction();
  fireEvent.click(save());
  await waitFor(() => expect(h.error).toHaveBeenCalledOnce());
  const reads = h.api.listFinanceAccounts.mock.calls.length;
  press("Cancel");
  const [title, message] = h.alert.mock.calls.at(-1) as [string, string];
  expect(title).toBe("Leave this transaction?");
  expect(message).toContain("may already have added it");
  expect(message).not.toContain("has not been added");
  confirm("Keep editing");
  expect(h.back).not.toHaveBeenCalled();
  press("Cancel");
  confirm("Leave");
  expect(h.back).toHaveBeenCalledOnce();
  // Finance data is re-read, so a recorded attempt shows up without a manual refresh.
  await waitFor(() => expect(h.api.listFinanceAccounts.mock.calls.length).toBeGreaterThan(reads));
});

it("keeps an edit made after an unconfirmed add that was recorded, and offers to add it anyway", async () => {
  h.api.createFinanceTransaction.mockRejectedValueOnce(new Error("timeout"));
  await fillNewTransaction();
  type("Date (ISO date/time)", "2026-11-03");
  fireEvent.click(save());
  await waitFor(() => expect(h.error).toHaveBeenCalledOnce());
  // The first attempt reached the ledger; the person then corrects the amount.
  h.api.listFinanceTransactions.mockResolvedValue({
    items: [
      { ...transaction, id: "t-new", merchant: "Corner bakery", amount: 8.4, date: "2026-11-03" },
    ],
    nextCursor: null,
  });
  type("Amount", "9.40");
  fireEvent.click(save());
  await waitFor(() => expect(h.info).toHaveBeenCalledOnce());
  const [message, options] = h.info.mock.calls[0] as [
    string,
    { id: string; action: { label: string; onClick: () => void } },
  ];
  expect(message).toContain("already added “Corner bakery”");
  expect(message).toContain("has not been added");
  expect(options.action.label).toBe("Add anyway");
  // The form stays open with the corrected draft, and nothing was written a second time.
  expect(h.back).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Amount")).toHaveProperty("value", "9.40");
  expect(h.api.createFinanceTransaction).toHaveBeenCalledOnce();
  // Add anyway writes the draft as it is when pressed, not as it was when the toast appeared.
  h.api.createFinanceTransaction.mockResolvedValue(transaction);
  type("Amount", "9.45");
  await act(async () => options.action.onClick());
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Transaction added", expect.anything()),
  );
  expect(h.api.createFinanceTransaction).toHaveBeenCalledTimes(2);
  expect(h.api.createFinanceTransaction).toHaveBeenLastCalledWith(
    expect.objectContaining({ amount: 9.45, merchant: "Corner bakery" }),
  );
  expect(h.back).toHaveBeenCalledOnce();
  expectNoInlineResult();
});

it("selects a category that already reads the same instead of creating its twin", async () => {
  await fillNewTransaction();
  press("New category");
  type("New category name", "rent and utilities");
  press("Add category");
  expect(h.api.createFinanceCategory).not.toHaveBeenCalled();
  expect(h.info).toHaveBeenCalledWith("“Rent And Utilities” already exists. It is now selected.");
  expect(screen.getByRole("button", { name: /Category.*Rent And Utilities/ })).toBeTruthy();
});

it("words the removal for any transaction in a manual account, added or imported", async () => {
  h.params = { id: transaction.id };
  mount(<FinanceTransactionScreen />);
  await removeAction();
  const [, message] = h.alert.mock.calls.at(-1) as [string, string];
  expect(message).toBe("This deletes the transaction from your records. It cannot be undone.");
});

it("raises one error when the automatic reload after a categorization fails", async () => {
  h.api.applyFinanceCategorizations.mockResolvedValue([applied(transaction), applied(other)]);
  await selectBoth();
  h.api.listFinanceTransactions.mockRejectedValue(new Error("offline"));
  await categorizeAs("Travel");
  await screen.findByRole("button", { name: /Reload transactions/ });
  const reloadErrors = h.error.mock.calls.filter(([message]) =>
    String(message).startsWith("Transactions could not reload."),
  );
  expect(reloadErrors).toHaveLength(1);
  // The categorization itself still reports its own confirmed result.
  expect(h.success).toHaveBeenCalledWith("2 transactions categorized as Travel", {
    id: "feedback",
  });
});

it("stays silent when the automatic reload succeeds", async () => {
  h.api.applyFinanceCategorizations.mockResolvedValue([applied(transaction), applied(other)]);
  await selectBoth();
  await categorizeAs("Travel");
  await waitFor(() => expect(h.api.listFinanceTransactions).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Select transactions" })).toHaveProperty(
      "disabled",
      false,
    ),
  );
  expect(h.error).not.toHaveBeenCalled();
  expect(h.success).toHaveBeenCalledOnce();
});

// Signing in as someone else mid-request: the old account's result is neither shown nor applied.

/** Mounts so the tree can be rendered again as a different signed-in person. */
function mountAs(node: () => ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const tree = () => <QueryClientProvider client={client}>{node()}</QueryClientProvider>;
  const view = render(tree());
  return () => {
    h.owner = "owner-b";
    view.rerender(tree());
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const settle = async (request: ReturnType<typeof deferred<unknown>>, value: unknown | Error) =>
  act(async () => {
    if (value instanceof Error) request.reject(value);
    else request.resolve(value);
    await request.promise.catch(() => undefined);
  });
const outcomes: [string, unknown][] = [
  ["answer", { ...transaction, id: "t-late" }],
  ["failure", new Error("timeout")],
];

it.each(outcomes)("drops a late add %s after the account changes", async (_name, value) => {
  const request = deferred<unknown>();
  h.api.createFinanceTransaction.mockReturnValue(request.promise);
  const switchOwner = mountAs(() => <FinanceTransactionEditor />);
  await screen.findByLabelText("Merchant");
  type("Merchant", "Corner bakery");
  type("Amount", "8.40");
  fireEvent.click(save());
  await waitFor(() => expect(h.api.createFinanceTransaction).toHaveBeenCalled());
  switchOwner();
  await settle(request, value);
  expect(h.dismiss).toHaveBeenCalledWith("feedback");
  expect(h.success).not.toHaveBeenCalled();
  expect(h.error).not.toHaveBeenCalled();
  expect(h.back).not.toHaveBeenCalled();
});

it.each([
  ["answer", { outcome: "completed", data: {}, communication: { headline: "" } }],
  ["failure", new Error("timeout")],
] as [
  string,
  unknown,
][])("drops a late removal %s after the account changes", async (_name, value) => {
  const request = deferred<unknown>();
  h.api.removeFinanceTransaction.mockReturnValue(request.promise);
  h.params = { id: transaction.id };
  const switchOwner = mountAs(() => <FinanceTransactionScreen />);
  await removeAction();
  confirm("Remove");
  await waitFor(() => expect(h.api.removeFinanceTransaction).toHaveBeenCalled());
  switchOwner();
  await settle(request, value);
  expect(h.dismiss).toHaveBeenCalledWith("feedback");
  expect(h.success).not.toHaveBeenCalled();
  expect(h.error).not.toHaveBeenCalled();
  expect(h.back).not.toHaveBeenCalled();
});

it.each([
  ["answer", category("c-pets", "Pet care")],
  ["failure", new Error("timeout")],
] as [
  string,
  unknown,
][])("drops a late category %s after the account changes", async (_name, value) => {
  const request = deferred<unknown>();
  h.api.createFinanceCategory.mockReturnValue(request.promise);
  const switchOwner = mountAs(() => <FinanceTransactionEditor />);
  await screen.findByLabelText("Merchant");
  press("New category");
  type("New category name", "Pet care");
  press("Add category");
  await waitFor(() => expect(h.api.createFinanceCategory).toHaveBeenCalled());
  switchOwner();
  await settle(request, value);
  expect(h.dismiss).toHaveBeenCalledWith("feedback");
  expect(h.success).not.toHaveBeenCalled();
  expect(h.error).not.toHaveBeenCalled();
});

it.each([
  ["answer", [applied(transaction), applied(other)]],
  ["failure", new Error("timeout")],
] as [
  string,
  unknown,
][])("drops a late categorization %s after the account changes", async (_name, value) => {
  const request = deferred<unknown>();
  h.api.applyFinanceCategorizations.mockReturnValue(request.promise);
  const switchOwner = mountAs(() => <Transactions />);
  await screen.findByRole("button", { name: /Corner market/ });
  press("Select transactions");
  press(/Corner market/);
  press(/Harbor cafe/);
  await categorizeAs("Travel");
  await waitFor(() => expect(h.api.applyFinanceCategorizations).toHaveBeenCalled());
  switchOwner();
  await settle(request, value);
  expect(h.dismiss).toHaveBeenCalledWith("feedback");
  expect(h.success).not.toHaveBeenCalled();
  expect(h.error).not.toHaveBeenCalled();
});

it("reports a removal the server did not complete without leaving the transaction", async () => {
  h.api.removeFinanceTransaction.mockResolvedValue({
    outcome: "needs_input",
    communication: { headline: "Confirm this removal in nohmi on the web." },
  });
  h.params = { id: transaction.id };
  mount(<FinanceTransactionScreen />);
  await removeAction();
  confirm("Remove");
  await waitFor(() =>
    expect(h.info).toHaveBeenCalledWith("Confirm this removal in nohmi on the web.", {
      id: "feedback",
    }),
  );
  expect(h.back).not.toHaveBeenCalled();
});

/** Times out an add, records it in the ledger, then changes the draft and saves again. */
async function recordedThenEdited(change: () => void) {
  h.api.createFinanceTransaction.mockRejectedValueOnce(new Error("timeout"));
  await fillNewTransaction();
  type("Date (ISO date/time)", "2026-11-03");
  fireEvent.click(save());
  await waitFor(() => expect(h.error).toHaveBeenCalledOnce());
  h.api.listFinanceTransactions.mockResolvedValue({
    items: [
      { ...transaction, id: "t-new", merchant: "Corner bakery", amount: 8.4, date: "2026-11-03" },
    ],
    nextCursor: null,
  });
  change();
  fireEvent.click(save());
  type Offer = { id: string; action: { label: string; onClick: () => void } };
  // The edit itself may raise an info toast; the offer is the one that carries an action.
  const offer = () =>
    h.info.mock.calls.find(([, options]) => (options as Offer | undefined)?.action) as
      | [string, Offer]
      | undefined;
  await waitFor(() => expect(offer()).toBeTruthy());
  const [message, options] = offer() as [string, Offer];
  expect(message).toContain("This changed draft has not been added.");
  expect(options.action.label).toBe("Add anyway");
  return options.action;
}

it("adds once when Add anyway is pressed twice", async () => {
  const action = await recordedThenEdited(() => type("Amount", "9.40"));
  h.api.createFinanceTransaction.mockResolvedValue(transaction);
  await act(async () => action.onClick());
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Transaction added", expect.anything()),
  );
  // The progress took the action's own toast and removed Add anyway from it; a second press
  // writes nothing.
  // Strict: a missing key would leave the merged toast's action in place.
  expect(h.loading.mock.lastCall).toStrictEqual([
    "Adding transaction…",
    { id: "feedback", action: undefined },
  ]);
  await act(async () => action.onClick());
  await act(async () => action.onClick());
  // Saving from the form after the add clears no toast: an id-less dismiss would clear them all.
  fireEvent.click(save());
  expect(h.api.createFinanceTransaction).toHaveBeenCalledTimes(2); // the timeout and the one add
  expect(h.success).toHaveBeenCalledOnce();
  expect(h.back).toHaveBeenCalledOnce();
  expect(h.dismiss.mock.calls.length).toBeGreaterThan(0);
  for (const [id] of h.dismiss.mock.calls) expect(id).toBe("feedback");
});

it("adds once when Add anyway is pressed again before the first add settles", async () => {
  const action = await recordedThenEdited(() => type("Amount", "9.40"));
  const request = deferred<unknown>();
  h.api.createFinanceTransaction.mockReturnValue(request.promise);
  await act(async () => action.onClick());
  await act(async () => action.onClick());
  await settle(request, transaction);
  await waitFor(() => expect(h.success).toHaveBeenCalledOnce());
  expect(h.api.createFinanceTransaction).toHaveBeenCalledTimes(2); // the timeout and the one add
});

it("adds nothing when Add anyway is pressed before a submitted outcome has rendered", async () => {
  const action = await recordedThenEdited(() => type("Amount", "9.40"));
  h.api.createFinanceTransaction.mockResolvedValue({ status: "needs_input" });
  await act(async () => {
    action.onClick();
    // The save has released its lock, and the form has not rendered its submitted state yet.
    await new Promise((resolve) => setTimeout(resolve, 0));
    action.onClick();
  });
  expect(h.api.createFinanceTransaction).toHaveBeenCalledTimes(2); // the timeout and the one add
});

it("adds nothing when Add anyway is pressed after the form was left", async () => {
  const action = await recordedThenEdited(() => type("Amount", "9.40"));
  cleanup();
  h.api.createFinanceTransaction.mockResolvedValue(transaction);
  const loads = h.loading.mock.calls.length;
  await act(async () => action.onClick());
  expect(h.api.createFinanceTransaction).toHaveBeenCalledOnce(); // only the timed-out attempt
  expect(h.loading).toHaveBeenCalledTimes(loads);
  // The orphaned toast is cleared rather than left offering a write.
  expect(h.dismiss).toHaveBeenCalledWith("feedback");
  expect(h.success).not.toHaveBeenCalled();
});

it.each([
  ["notes", () => type("Notes", "For the team breakfast")],
  [
    "category",
    () => {
      press("New category");
      type("New category name", "travel");
      press("Add category");
    },
  ],
] as [
  string,
  () => void,
][])("keeps a %s edit made after an unconfirmed add that was recorded", async (_field, change) => {
  await recordedThenEdited(change);
  // The form is still open with the edit; nothing was written again and nothing closed.
  expect(h.back).not.toHaveBeenCalled();
  expect(h.api.createFinanceTransaction).toHaveBeenCalledOnce();
});

it("marks empty fields Required or Optional instead of showing values that look filled in", async () => {
  mount(<FinanceTransactionEditor />);
  expect(await screen.findByLabelText("Merchant")).toHaveProperty("placeholder", "Required");
  expect(screen.getByLabelText("Amount")).toHaveProperty("placeholder", "Required");
  expect(screen.getByLabelText("Notes")).toHaveProperty("placeholder", "Optional");
});

it("offers Add only where a list is given somewhere to add to", async () => {
  mount(<Transactions accountId={account.id} />);
  await screen.findByRole("button", { name: /Corner market/ });
  expect(screen.queryByRole("button", { name: "Add transaction" })).toBeNull();
  // Entering selection replaces the browsing commands, Add included.
  cleanup();
  const onAdd = vi.fn();
  mount(<Transactions onAdd={onAdd} />);
  await screen.findByRole("button", { name: /Corner market/ });
  press("Add transaction");
  expect(onAdd).toHaveBeenCalledOnce();
  press("Select transactions");
  expect(screen.queryByRole("button", { name: "Add transaction" })).toBeNull();
});
