// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PropsWithChildren, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FinanceTransactionScreen } from "./details";
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
    createFinanceTransaction: vi.fn(),
    updateFinanceTransaction: vi.fn(),
    removeFinanceTransaction: vi.fn(),
    createFinanceCategory: vi.fn(),
    applyFinanceCategorizations: vi.fn(),
    setFinanceTransactionBreakdown: vi.fn(),
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
  amount: 60,
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
const allocation = (
  id: string,
  categoryId: string,
  amount: number,
  allocationOrder: number,
  treatment = "personal",
) => ({
  id,
  categoryId,
  amount,
  allocationOrder,
  treatment,
  state: "active",
  invalidatedAt: null,
  rationale: "Agreed at the till",
  revision: 1,
});
/** Saved in an order that differs from the array, so ordering comes from `allocationOrder`. */
const split = {
  ...transaction,
  category: null,
  categoryId: null,
  allocations: [
    allocation("a-2", "c-travel", 20, 1, "reimbursable"),
    allocation("a-1", "c-groceries", 40, 0),
  ],
};
const rejection = (status: number) =>
  new ApiClientError({ code: "error", message: "rejected", status });
function mount(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}
function confirm(label: string) {
  const buttons = h.alert.mock.calls.at(-1)?.[2] as { text: string; onPress?: () => void }[];
  act(() => buttons.find((button) => button.text === label)?.onPress?.());
}
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const choose = (name: string | RegExp) =>
  fireEvent.click(
    within(screen.getAllByRole("dialog").at(-1) as HTMLElement).getByRole("button", { name }),
  );
const save = () => screen.getByRole("button", { name: "Save splits" });
const amount = (part: number) =>
  (screen.getByLabelText(`Part ${part} amount`) as HTMLInputElement).value;
/** Picks the category of a part; parts are listed in order. */
function categorize(part: number, name: string) {
  fireEvent.click(screen.getAllByRole("button", { name: /^Category/ })[part - 1] as HTMLElement);
  choose(name);
}
/** Action results are Sonner-only: no rendered copy may repeat a toast message. */
function expectNoInlineResult() {
  for (const toast of [h.error, h.success, h.info, h.loading])
    for (const [message] of toast.mock.calls)
      expect(screen.queryByText(String(message))).toBeNull();
}
async function openSplits(record: object = transaction) {
  h.params = { id: transaction.id, field: "splits" };
  h.api.getFinanceTransaction.mockResolvedValue({ data: record });
  const view = mount(<FinanceTransactionEditor />);
  await screen.findByLabelText("Part 1 amount");
  return view;
}
const openActions = async () =>
  fireEvent.click(await screen.findByRole("button", { name: "Transaction actions" }));

beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of Object.values(h.api)) mock.mockReset();
  h.owner = "owner-a";
  h.params = {};
  h.api.listFinanceAccounts.mockResolvedValue({
    accounts: [account],
    totals: { cash: 0, netWorth: 0, debt: 0, investments: 0, otherAssets: 0 },
    accountSemantics: { possibleDuplicateGroups: [] },
  });
  h.api.getFinanceCategories.mockResolvedValue(categories);
  h.api.getFinanceReviewQueue.mockResolvedValue([]);
  h.api.getFinanceTransaction.mockResolvedValue({ data: transaction });
});
afterEach(cleanup);

// Creating a split

it("starts an unsplit transaction with its whole amount and an empty second part", async () => {
  await openSplits();
  expect(h.screen).toHaveBeenLastCalledWith(
    expect.objectContaining({ title: "split transaction" }),
  );
  expect(amount(1)).toBe("60.00");
  expect(amount(2)).toBe("");
  expect(screen.getAllByRole("button", { name: /^Category/ })[0]?.textContent).toContain(
    "Groceries",
  );
  expect(screen.getByText("Left to assign")).toBeTruthy();
  expect(screen.getByText("Every cent is assigned.")).toBeTruthy();
  // Nothing was edited, so there is nothing to save and Close needs no confirmation.
  expect(save()).toHaveProperty("disabled", true);
  press("Close");
  expect(h.alert).not.toHaveBeenCalled();
  expect(h.back).toHaveBeenCalled();
});

it("shows what is left to assign and blocks saving until the parts reconcile", async () => {
  await openSplits();
  type("Part 1 amount", "45.50");
  expect(screen.getByText("$14.50")).toBeTruthy();
  expect(screen.getByText("Of $60.00")).toBeTruthy();
  expect(save()).toHaveProperty("disabled", true);
  categorize(2, "Travel");
  type("Part 2 amount", "20");
  expect(screen.getByText("Over-assigned")).toBeTruthy();
  expect(screen.getByText("$5.50")).toBeTruthy();
  expect(save()).toHaveProperty("disabled", true);
  fireEvent.click(save());
  expect(h.api.setFinanceTransactionBreakdown).not.toHaveBeenCalled();
  type("Part 2 amount", "14.50");
  expect(screen.getByText("Every cent is assigned.")).toBeTruthy();
  expect(save()).toHaveProperty("disabled", false);
});

it("saves a new split against the revision it was opened from and returns", async () => {
  h.api.setFinanceTransactionBreakdown.mockResolvedValue({ ...split, updatedAt: "later" });
  await openSplits();
  type("Part 1 amount", "40");
  categorize(2, "Travel");
  type("Part 2 amount", "20.00");
  fireEvent.click(screen.getAllByRole("button", { name: /^Treatment, Mine/ })[1] as HTMLElement);
  choose("Reimbursable");
  press("Save splits");
  await waitFor(() => expect(h.success).toHaveBeenCalledWith("Splits saved", { id: "feedback" }));
  expect(h.loading).toHaveBeenCalledWith("Saving splits…");
  expect(h.api.setFinanceTransactionBreakdown).toHaveBeenCalledTimes(1);
  expect(h.api.setFinanceTransactionBreakdown).toHaveBeenCalledWith(transaction.id, {
    allocations: [
      {
        amount: 40,
        categoryId: "c-groceries",
        rationale: "User-entered transaction breakdown.",
        treatment: "personal",
      },
      {
        amount: 20,
        categoryId: "c-travel",
        rationale: "User-entered transaction breakdown.",
        treatment: "reimbursable",
      },
    ],
    expectedTransactionUpdatedAt: transaction.updatedAt,
    rationale: "User-entered transaction breakdown.",
  });
  expect(h.back).toHaveBeenCalledTimes(1);
  expectNoInlineResult();
});

it("requires a category and a valid amount on every part", async () => {
  await openSplits();
  type("Part 1 amount", "40");
  type("Part 2 amount", "20");
  // The second part has no category yet.
  expect(screen.getAllByRole("button", { name: /^Category/ })[1]?.textContent).toContain("Choose");
  expect(save()).toHaveProperty("disabled", true);
  categorize(2, "Travel");
  expect(save()).toHaveProperty("disabled", false);
  type("Part 2 amount", "20,0");
  expect(screen.getByText("Enter an amount above zero, such as 12.50.")).toBeTruthy();
  expect(save()).toHaveProperty("disabled", true);
});

it("will not save two parts with the same category and treatment", async () => {
  await openSplits();
  type("Part 1 amount", "40");
  categorize(2, "Groceries");
  type("Part 2 amount", "20");
  expect(screen.getByText(/Two parts use the same category and treatment/)).toBeTruthy();
  expect(save()).toHaveProperty("disabled", true);
  fireEvent.click(screen.getAllByRole("button", { name: /^Treatment, Mine/ })[1] as HTMLElement);
  choose("Reimbursable");
  expect(screen.queryByText(/Two parts use the same category and treatment/)).toBeNull();
  expect(save()).toHaveProperty("disabled", false);
});

// Editing and removing

it("opens saved parts in their saved order and changes them", async () => {
  h.api.setFinanceTransactionBreakdown.mockResolvedValue(split);
  await openSplits(split);
  expect(amount(1)).toBe("40.00");
  expect(amount(2)).toBe("20.00");
  expect(screen.getByRole("button", { name: /^Treatment, Reimbursable/ })).toBeTruthy();
  type("Part 1 amount", "35");
  press("Add part");
  // A new part takes what is still unassigned.
  expect(amount(3)).toBe("5.00");
  categorize(3, "Rent And Utilities");
  press("Save splits");
  await waitFor(() => expect(h.success).toHaveBeenCalledWith("Splits saved", { id: "feedback" }));
  expect(h.api.setFinanceTransactionBreakdown).toHaveBeenCalledWith(split.id, {
    allocations: [
      {
        amount: 35,
        categoryId: "c-groceries",
        rationale: "Agreed at the till",
        treatment: "personal",
      },
      {
        amount: 20,
        categoryId: "c-travel",
        rationale: "Agreed at the till",
        treatment: "reimbursable",
      },
      {
        amount: 5,
        categoryId: "c-rent",
        rationale: "User-entered transaction breakdown.",
        treatment: "personal",
      },
    ],
    expectedTransactionUpdatedAt: split.updatedAt,
    rationale: "User-entered transaction breakdown.",
  });
});

it("removes a part, and a lone remaining part saves the transaction as one category", async () => {
  h.api.setFinanceTransactionBreakdown.mockResolvedValue({
    ...transaction,
    category: "Groceries",
  });
  await openSplits(split);
  press("Remove part 2");
  expect(screen.queryByLabelText("Part 2 amount")).toBeNull();
  // The last part cannot be removed, and its amount no longer covers the transaction.
  expect(screen.queryByRole("button", { name: /^Remove part/ })).toBeNull();
  expect(screen.getByText("$20.00")).toBeTruthy();
  expect(save()).toHaveProperty("disabled", true);
  type("Part 1 amount", "60");
  press("Save splits");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Saved as one category", { id: "feedback" }),
  );
  expect(h.api.setFinanceTransactionBreakdown).toHaveBeenCalledWith(
    split.id,
    expect.objectContaining({
      allocations: [
        {
          amount: 60,
          categoryId: "c-groceries",
          rationale: "Agreed at the till",
          treatment: "personal",
        },
      ],
    }),
  );
});

it("asks before discarding edited parts and writes nothing on Cancel", async () => {
  await openSplits(split);
  type("Part 1 amount", "10");
  press("Cancel");
  expect(h.alert).toHaveBeenCalledWith(
    "Discard changes?",
    "The splits have not been saved.",
    expect.anything(),
  );
  confirm("Keep editing");
  expect(h.back).not.toHaveBeenCalled();
  expect(amount(1)).toBe("10");
  press("Cancel");
  confirm("Discard");
  expect(h.back).toHaveBeenCalledTimes(1);
  expect(h.api.setFinanceTransactionBreakdown).not.toHaveBeenCalled();
});

// Failed and unconfirmed saves

async function editedSplit() {
  const view = await openSplits(split);
  type("Part 1 amount", "30");
  type("Part 2 amount", "30");
  return view;
}

it("reports a rejected save once, keeps the draft and stays on the form", async () => {
  h.api.setFinanceTransactionBreakdown.mockRejectedValue(rejection(400));
  await editedSplit();
  press("Save splits");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Couldn’t save these splits. Nothing was changed; your draft is still here.",
      { id: "feedback" },
    ),
  );
  expect(h.error).toHaveBeenCalledTimes(1);
  expect(h.success).not.toHaveBeenCalled();
  expect(h.back).not.toHaveBeenCalled();
  expect(amount(1)).toBe("30");
  await waitFor(() => expect(save()).toHaveProperty("disabled", false));
  expectNoInlineResult();
});

it("reports a conflict as nothing saved and points to the latest version", async () => {
  h.api.setFinanceTransactionBreakdown.mockRejectedValue(rejection(409));
  await editedSplit();
  press("Save splits");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(expect.stringContaining("Nothing was saved."), {
      id: "feedback",
    }),
  );
  expect(h.back).not.toHaveBeenCalled();
  expect(amount(2)).toBe("30");
  expectNoInlineResult();
});

it("does not call an unconfirmed save saved, and re-reads the transaction", async () => {
  h.api.setFinanceTransactionBreakdown.mockRejectedValue(new Error("timeout"));
  await editedSplit();
  const reads = h.api.getFinanceTransaction.mock.calls.length;
  press("Save splits");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(expect.stringContaining("Couldn’t confirm the save."), {
      id: "feedback",
    }),
  );
  expect(h.error).toHaveBeenCalledTimes(1);
  expect(h.success).not.toHaveBeenCalled();
  expect(h.back).not.toHaveBeenCalled();
  // The page behind shows only what the server returns, so it is read again.
  await waitFor(() => expect(h.api.getFinanceTransaction.mock.calls.length).toBeGreaterThan(reads));
  // The draft is kept, and is not replaced by the refreshed record.
  expect(amount(1)).toBe("30");
  expectNoInlineResult();
  // Leaving now never claims the splits were not saved.
  press("Cancel");
  expect(h.alert).toHaveBeenCalledWith(
    "Leave these splits?",
    expect.stringContaining("may already have gone through"),
    expect.anything(),
  );
  confirm("Leave");
  expect(h.back).toHaveBeenCalledTimes(1);
});

it("treats a result that was not applied as not saved and locks the draft", async () => {
  h.api.setFinanceTransactionBreakdown.mockResolvedValue({ status: "pending_review" });
  await editedSplit();
  press("Save splits");
  await waitFor(() =>
    expect(h.info).toHaveBeenCalledWith("Submitted for review. The splits have not been applied.", {
      id: "feedback",
    }),
  );
  expect(h.success).not.toHaveBeenCalled();
  expect(h.back).not.toHaveBeenCalled();
  expect(save()).toHaveProperty("disabled", true);
  expect(screen.getByLabelText("Part 1 amount")).toHaveProperty("disabled", true);
  press("Close");
  expect(h.alert).not.toHaveBeenCalled();
});

it("sends one request for a double press and locks the parts while it runs", async () => {
  let settle: (value: unknown) => void = () => undefined;
  h.api.setFinanceTransactionBreakdown.mockReturnValue(
    new Promise((resolve) => {
      settle = resolve;
    }),
  );
  await editedSplit();
  press("Save splits");
  fireEvent.click(save());
  expect(h.api.setFinanceTransactionBreakdown).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("Part 1 amount")).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "Add part" })).toHaveProperty("disabled", true);
  await act(async () => settle(split));
  await waitFor(() => expect(h.success).toHaveBeenCalledTimes(1));
});

it("says nothing and writes nothing more once the form has been left", async () => {
  let fail: (error: unknown) => void = () => undefined;
  h.api.setFinanceTransactionBreakdown.mockReturnValue(
    new Promise((_, reject) => {
      fail = reject;
    }),
  );
  const view = await editedSplit();
  press("Save splits");
  view.unmount();
  await act(async () => fail(new Error("timeout")));
  expect(h.dismiss).toHaveBeenCalledWith("feedback");
  expect(h.error).not.toHaveBeenCalled();
  expect(h.success).not.toHaveBeenCalled();
});

// Transaction details

it("offers Split transaction on a posted transaction and opens the split editor", async () => {
  h.params = { id: transaction.id };
  mount(<FinanceTransactionScreen />);
  await openActions();
  press("Split transaction");
  expect(h.push).toHaveBeenCalledWith({
    pathname: "/finance-transaction-edit",
    params: { id: transaction.id, field: "splits" },
  });
});

it("does not offer splitting while a transaction is pending", async () => {
  h.params = { id: transaction.id };
  h.api.getFinanceTransaction.mockResolvedValue({ data: { ...transaction, pending: true } });
  mount(<FinanceTransactionScreen />);
  await screen.findByText("Pending");
  await openActions();
  expect(screen.queryByRole("button", { name: /Split transaction|Edit splits/ })).toBeNull();
});

it("shows a split transaction's parts by category and opens them from the category row", async () => {
  h.params = { id: transaction.id };
  h.api.getFinanceTransaction.mockResolvedValue({ data: split });
  mount(<FinanceTransactionScreen />);
  // A split has no single category; it is not reported as missing one.
  const row = await screen.findByRole("button", { name: /Category.*Split in 2 parts/ });
  expect(screen.queryByText("Uncategorized")).toBeNull();
  expect(await screen.findByText("Travel")).toBeTruthy();
  expect(screen.getByText("Reimbursable")).toBeTruthy();
  expect(screen.getByText("$40.00")).toBeTruthy();
  fireEvent.click(row);
  expect(h.push).toHaveBeenCalledWith({
    pathname: "/finance-transaction-edit",
    params: { id: transaction.id, field: "splits" },
  });
  await openActions();
  expect(screen.getByRole("button", { name: "Edit splits" })).toBeTruthy();
});

// Draft edges and late answers

it("opens a part whose category is gone as Unavailable and restores a blank rationale", async () => {
  h.api.setFinanceTransactionBreakdown.mockResolvedValue(split);
  await openSplits({
    ...split,
    allocations: [
      { ...allocation("a-1", "c-closed", 40, 0), rationale: "  " },
      { ...allocation("a-2", "c-travel", 20, 1), rationale: null },
    ],
  });
  expect(screen.getAllByRole("button", { name: /^Category/ })[0]?.textContent).toContain(
    "Unavailable",
  );
  categorize(1, "Groceries");
  press("Save splits");
  await waitFor(() => expect(h.api.setFinanceTransactionBreakdown).toHaveBeenCalled());
  const sent = h.api.setFinanceTransactionBreakdown.mock.calls[0]?.[1] as {
    allocations: { rationale: string }[];
  };
  expect(sent.allocations.map((part) => part.rationale)).toEqual([
    "User-entered transaction breakdown.",
    "User-entered transaction breakdown.",
  ]);
});

it("starts an uncategorized transaction with a category still to choose", async () => {
  await openSplits({ ...transaction, category: null, categoryId: undefined });
  expect(screen.getAllByRole("button", { name: /^Category/ })[0]?.textContent).toContain("Choose");
});

it("closes a part's category sheet from its row and when the part is removed", async () => {
  await openSplits(split);
  const rows = () => screen.getAllByRole("button", { name: /^Category/ });
  fireEvent.click(rows()[1] as HTMLElement);
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  fireEvent.click(rows()[1] as HTMLElement);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(rows()[1] as HTMLElement);
  press("Remove part 2");
  expect(screen.queryByRole("dialog")).toBeNull();
  // An added part with nothing left to assign starts blank.
  type("Part 1 amount", "60");
  press("Add part");
  expect(amount(2)).toBe("");
});

it("keeps a pending split transaction's parts read-only", async () => {
  h.params = { id: transaction.id };
  h.api.getFinanceTransaction.mockResolvedValue({ data: { ...split, pending: true } });
  mount(<FinanceTransactionScreen />);
  expect(await screen.findByText("Split in 2 parts")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Category.*Split in 2 parts/ })).toBeNull();
});

it.each([
  ["answer", split],
  ["failure", new Error("timeout")],
] as [
  string,
  unknown,
][])("drops a late split %s after the account changes", async (_name, value) => {
  let resolve: (value: unknown) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const request = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  h.api.setFinanceTransactionBreakdown.mockReturnValue(request);
  h.params = { id: transaction.id, field: "splits" };
  h.api.getFinanceTransaction.mockResolvedValue({ data: split });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const tree = () => (
    <QueryClientProvider client={client}>
      <FinanceTransactionEditor />
    </QueryClientProvider>
  );
  const view = render(tree());
  await screen.findByLabelText("Part 1 amount");
  type("Part 1 amount", "30");
  type("Part 2 amount", "30");
  press("Save splits");
  h.owner = "owner-b";
  view.rerender(tree());
  await act(async () => {
    if (value instanceof Error) reject(value);
    else resolve(value);
    await request.catch(() => undefined);
  });
  expect(h.dismiss).toHaveBeenCalledWith("feedback");
  expect(h.success).not.toHaveBeenCalled();
  expect(h.error).not.toHaveBeenCalled();
  expect(h.back).not.toHaveBeenCalled();
});
