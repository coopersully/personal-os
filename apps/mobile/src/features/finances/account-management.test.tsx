// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FinanceAccountDuplicate } from "./account-duplicate";
import { FinanceAccountEditor } from "./account-editor";
import { FinanceAccountsScreen } from "./accounts";
import { FinanceAccountScreen } from "./details";

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
  params: {} as Record<string, string>,
  push: vi.fn(),
  navigate: vi.fn(),
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
    createFinanceAccount: vi.fn(),
    updateFinanceAccount: vi.fn(),
    syncFinanceAccount: vi.fn(),
    disconnectFinanceAccount: vi.fn(),
    getFinanceAccountDuplicatePreview: vi.fn(),
    resolveFinanceAccountDuplicate: vi.fn(),
  },
}));
vi.mock("react-native", () => {
  const Box = ({ children }: PropsWithChildren) => <div>{children}</div>;
  return {
    StyleSheet: { create: (value: unknown) => value },
    AppState: { currentState: "active", addEventListener: () => ({ remove: vi.fn() }) },
    Keyboard: { addListener: () => ({ remove: vi.fn() }) },
    useWindowDimensions: () => ({ height: 852, width: 393 }),
    Image: () => null,
    View: Box,
    ScrollView: Box,
    Text: Box,
    Modal: ({ children }: PropsWithChildren) => <div role="dialog">{children}</div>,
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
      accessibilityHint,
    }: PropsWithChildren<{
      onPress?: () => void;
      disabled?: boolean;
      accessibilityLabel?: string;
      accessibilityHint?: string;
    }>) => (
      <button
        type="button"
        aria-label={accessibilityLabel}
        aria-description={accessibilityHint}
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
      editable = true,
    }: {
      accessibilityLabel?: string;
      value: string;
      onChangeText: (value: string) => void;
      editable?: boolean;
    }) => (
      <input
        aria-label={accessibilityLabel}
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
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("../auth/context", () => ({
  useOptionalAuth: () => null,
  useAuth: () => ({
    state: { user: { id: h.owner, planningTimezone: "America/New_York" } },
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

const synchronization = {
  failureCode: null,
  failureCount: 0,
  lastAttemptAt: "2026-11-12T12:00:00Z",
  lastSuccessAt: "2026-11-12T12:00:00Z",
  message: null,
  nextRetryAt: null,
  recovery: null,
  state: "current",
};
const manual = {
  id: "manual-1",
  name: "House fund",
  institution: "Harbor Credit Union",
  currencyCode: "USD",
  balance: 2400,
  includeInPlanning: true,
  kind: "cash",
  provider: "manual",
  ownershipType: "individual",
  ownershipShare: 1,
  synchronization,
  status: "manual",
  accountMask: null,
  lastSyncedAt: null,
  createdAt: "2026-10-01T12:00:00Z",
  updatedAt: "2026-11-01T12:00:00Z",
};
const linked = {
  ...manual,
  id: "linked-1",
  name: "Everyday checking",
  institution: "Example bank",
  provider: "plaid",
  status: "connected",
  accountMask: "1234",
  lastSyncedAt: "2026-11-12T12:00:00Z",
};
const twin = { ...linked, id: "linked-2", name: "Checking (new login)" };
const revision = "b".repeat(64);
const preview = {
  keptAccount: twin,
  redundantAccount: linked,
  keptTransactionCount: 40,
  redundantTransactionCount: 38,
  overlappingTransactionCount: 36,
  uniqueRedundantTransactionCount: 2,
  match: "provider_identity",
  revision,
};
const completed = <T,>(data: T) => ({
  outcome: "completed",
  data,
  communication: { headline: "" },
});
const rejection = (status: number) =>
  new ApiClientError({ code: "error", message: "rejected", status });
function accounts(list: unknown[], duplicates: string[][] = []) {
  return {
    accounts: list,
    totals: { cash: 0, netWorth: 0, debt: 0, investments: 0, otherAssets: 0 },
    accountSemantics: {
      possibleDuplicateGroups: duplicates.map((accountIds) => ({ accountIds })),
      unresolvedOwnershipAccountIds: [],
      excludedAccountIds: [],
      trustworthy: true,
    },
  };
}
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
/** Action results are Sonner-only: no rendered copy may repeat a toast message. */
function expectNoInlineResult() {
  for (const toast of [h.error, h.success, h.info])
    for (const [message] of toast.mock.calls)
      expect(screen.queryByText(String(message))).toBeNull();
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of Object.values(h.api)) mock.mockReset();
  h.owner = "owner-a";
  h.params = {};
  h.api.listFinanceAccounts.mockResolvedValue(accounts([manual, linked]));
  h.api.listFinanceTransactions.mockResolvedValue({ items: [], nextCursor: null });
});
afterEach(cleanup);

it("opens the manual account form from the Accounts tab", async () => {
  mount(<FinanceAccountsScreen />);
  await screen.findByRole("button", { name: /Everyday checking/ });
  press("Add account");
  expect(h.push).toHaveBeenCalledWith("/finance-account-edit");
});

it("adds a manual account only once its fields are valid", async () => {
  h.api.createFinanceAccount.mockResolvedValue({ ...manual, id: "manual-2" });
  mount(<FinanceAccountEditor />);
  await screen.findByLabelText("Name");
  expect(screen.getByRole("button", { name: "Save changes" })).toHaveProperty("disabled", true);
  // The form says why Save is unavailable, and the page heading names the screen once.
  expect(screen.getByText(/Name and Institution are required\./)).toBeTruthy();
  expect(screen.getAllByText("Add account").length).toBe(1);
  expect(h.screen.mock.lastCall?.[0]).toMatchObject({ title: "", headerBackVisible: false });
  type("Name", "  Travel fund ");
  type("Institution", "Harbor Credit Union");
  type("Currency", "eu");
  type("Balance", "12.345");
  expect(screen.getByRole("button", { name: "Save changes" })).toHaveProperty("disabled", true);
  // An invalid field says what to correct instead of relying on colour.
  expect(screen.getByText("Use a three-letter code such as USD.")).toBeTruthy();
  expect(screen.getByText("Enter an amount such as 2400.00.")).toBeTruthy();
  type("Currency", "eur");
  type("Balance", "1,250.50");
  expect(screen.queryByText("Use a three-letter code such as USD.")).toBeNull();
  expect(screen.queryByText("Enter an amount such as 2400.00.")).toBeNull();
  press("Account type, Cash");
  press("Investments");
  press("Save changes");
  await waitFor(() => expect(h.success).toHaveBeenCalledWith("Account added", { id: "feedback" }));
  expect(h.api.createFinanceAccount).toHaveBeenCalledWith({
    balance: 1250.5,
    currencyCode: "EUR",
    institution: "Harbor Credit Union",
    kind: "investment",
    name: "Travel fund",
    provider: "manual",
  });
  expect(h.loading).toHaveBeenCalledOnce();
  expect(h.back).toHaveBeenCalledOnce();
  expectNoInlineResult();
});

it("keeps the draft when adding is rejected and leaves an unknown balance blank", async () => {
  h.api.createFinanceAccount.mockRejectedValue(rejection(422));
  mount(<FinanceAccountEditor />);
  await screen.findByLabelText("Name");
  type("Name", "Travel fund");
  type("Institution", "Harbor Credit Union");
  press("Save changes");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith("Couldn’t add this account. Your draft is still here.", {
      id: "feedback",
    }),
  );
  expect(h.api.createFinanceAccount).toHaveBeenCalledWith(
    expect.objectContaining({ balance: null, currencyCode: null, kind: "cash" }),
  );
  expect(h.back).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Name")).toHaveProperty("value", "Travel fund");
  // A definitive rejection wrote nothing, so the retry creates without a lookup.
  const reads = h.api.listFinanceAccounts.mock.calls.length;
  h.api.createFinanceAccount.mockResolvedValue(manual);
  press("Save changes");
  await waitFor(() => expect(h.success).toHaveBeenCalled());
  expect(h.api.listFinanceAccounts).toHaveBeenCalledTimes(reads + 1); // refresh after success only
  expectNoInlineResult();
});

it("does not add a second account after an uncertain result that was recorded", async () => {
  h.api.createFinanceAccount.mockRejectedValue(new Error("connection lost"));
  mount(<FinanceAccountEditor />);
  await screen.findByLabelText("Name");
  type("Name", "Travel fund");
  type("Institution", "Harbor Credit Union");
  press("Save changes");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      expect.stringContaining("Couldn’t confirm the account was added."),
      { id: "feedback" },
    ),
  );
  expect(h.success).not.toHaveBeenCalled();
  // The lookup itself can fail: nothing is written while the outcome is unknown.
  h.api.listFinanceAccounts.mockRejectedValueOnce(new Error("offline"));
  press("Save changes");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Couldn’t check whether the account was added. Try again shortly.",
      { id: "feedback" },
    ),
  );
  h.api.listFinanceAccounts.mockResolvedValue(
    accounts([
      manual,
      linked,
      { ...manual, id: "manual-9", name: "Travel fund", institution: "Harbor Credit Union" },
    ]),
  );
  press("Save changes");
  await waitFor(() => expect(h.success).toHaveBeenCalledWith("Account added", { id: "feedback" }));
  expect(h.api.createFinanceAccount).toHaveBeenCalledOnce();
  expect(h.back).toHaveBeenCalledOnce();
});

it("matches an uncertain add by the values it was sent with after the draft is corrected", async () => {
  h.api.createFinanceAccount.mockRejectedValue(new Error("timeout"));
  mount(<FinanceAccountEditor />);
  await screen.findByLabelText("Name");
  type("Name", "Savigns");
  type("Institution", "Harbor Credit Union");
  press("Save changes");
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  // The first attempt was recorded under the misspelt name.
  h.api.listFinanceAccounts.mockResolvedValue(
    accounts([
      manual,
      linked,
      { ...manual, id: "manual-9", name: "Savigns", institution: "Harbor Credit Union" },
    ]),
  );
  type("Name", "Savings");
  press("Save changes");
  await waitFor(() =>
    expect(h.info).toHaveBeenCalledWith(
      "Your earlier attempt already added “Savigns”. Edit that account to change it.",
      { id: "feedback" },
    ),
  );
  expect(h.api.createFinanceAccount).toHaveBeenCalledOnce();
  expect(h.success).not.toHaveBeenCalled();
  expect(h.back).toHaveBeenCalledOnce();
  expectNoInlineResult();
});

it("adds the corrected draft when the earlier uncertain attempt was not recorded", async () => {
  h.api.createFinanceAccount
    .mockRejectedValueOnce(new Error("timeout"))
    .mockResolvedValue({ ...manual, id: "manual-2" });
  mount(<FinanceAccountEditor />);
  await screen.findByLabelText("Name");
  type("Name", "Savigns");
  type("Institution", "Harbor Credit Union");
  press("Save changes");
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  type("Name", "Savings");
  press("Save changes");
  await waitFor(() => expect(h.success).toHaveBeenCalledWith("Account added", { id: "feedback" }));
  expect(h.api.createFinanceAccount).toHaveBeenCalledTimes(2);
  expect(h.api.createFinanceAccount.mock.calls[1][0].name).toBe("Savings");
});

it("retries an uncertain add once the account is confirmed absent", async () => {
  h.api.createFinanceAccount
    .mockRejectedValueOnce(rejection(503))
    .mockResolvedValue({ ...manual, id: "manual-2" });
  mount(<FinanceAccountEditor />);
  await screen.findByLabelText("Name");
  // An existing account with the same identity is not mistaken for the lost attempt.
  type("Name", manual.name);
  type("Institution", manual.institution);
  press("Save changes");
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  press("Save changes");
  await waitFor(() => expect(h.success).toHaveBeenCalledWith("Account added", { id: "feedback" }));
  expect(h.api.createFinanceAccount).toHaveBeenCalledTimes(2);
});

it("renames an account against the revision that was reviewed", async () => {
  h.params = { id: linked.id };
  h.api.updateFinanceAccount.mockResolvedValue(completed({ ...linked, name: "Bills" }));
  mount(<FinanceAccountEditor />);
  expect(await screen.findByLabelText("Name")).toHaveProperty("value", linked.name);
  // A connected account's balance belongs to its institution.
  expect(screen.queryByLabelText("Balance")).toBeNull();
  expect(screen.queryByLabelText("Currency")).toBeNull();
  press("Close");
  expect(h.back).toHaveBeenCalledOnce();
  type("Name", " Bills ");
  press("Cancel");
  expect(h.alert).toHaveBeenCalledWith("Discard changes?", expect.any(String), expect.any(Array));
  confirm("Keep editing");
  expect(h.back).toHaveBeenCalledOnce();
  press("Save changes");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Account updated", { id: "feedback" }),
  );
  expect(h.api.updateFinanceAccount).toHaveBeenCalledWith(linked.id, {
    name: "Bills",
    expectedUpdatedAt: linked.updatedAt,
    idempotencyKey: expect.any(String),
  });
  expect(h.back).toHaveBeenCalledTimes(2);
  expectNoInlineResult();
});

it("updates a manual balance and closes without writing when nothing changed", async () => {
  h.params = { id: manual.id };
  h.api.updateFinanceAccount.mockResolvedValue(completed(manual));
  mount(<FinanceAccountEditor />);
  await screen.findByLabelText("Balance");
  type("Balance", "");
  type("Balance", "2400");
  press("Save changes");
  await waitFor(() => expect(h.info).toHaveBeenCalledWith("No changes to save", expect.anything()));
  expect(h.api.updateFinanceAccount).not.toHaveBeenCalled();
  type("Balance", "");
  press("Save changes");
  await waitFor(() => expect(h.success).toHaveBeenCalled());
  expect(h.api.updateFinanceAccount).toHaveBeenCalledWith(
    manual.id,
    expect.objectContaining({ balance: null }),
  );
});

it("keeps a rename draft when the account changed elsewhere", async () => {
  h.params = { id: linked.id };
  h.api.updateFinanceAccount.mockRejectedValue(rejection(409));
  mount(<FinanceAccountEditor />);
  await screen.findByLabelText("Name");
  const reads = h.api.listFinanceAccounts.mock.calls.length;
  type("Name", "Bills");
  press("Save changes");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      expect.stringContaining("This account changed elsewhere."),
      { id: "feedback" },
    ),
  );
  // The conflict re-reads accounts, so reopening the editor starts from the latest revision.
  await waitFor(() => expect(h.api.listFinanceAccounts).toHaveBeenCalledTimes(reads + 1));
  expect(h.back).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Name")).toHaveProperty("value", "Bills");
  // A confirmed conflict wrote nothing, so the next attempt is a new request.
  const first = h.api.updateFinanceAccount.mock.calls[0][1].idempotencyKey;
  press("Save changes");
  await waitFor(() => expect(h.api.updateFinanceAccount).toHaveBeenCalledTimes(2));
  expect(h.api.updateFinanceAccount.mock.calls[1][1].idempotencyKey).not.toBe(first);
  expectNoInlineResult();
});

it("retries an uncertain rename with the same key and reports unapplied outcomes honestly", async () => {
  h.params = { id: linked.id };
  h.api.updateFinanceAccount
    .mockRejectedValueOnce(new Error("timeout"))
    .mockResolvedValueOnce({
      outcome: "user_input_required",
      communication: { headline: "Approve this change in Finance chat" },
    })
    .mockResolvedValue({ outcome: "failed", communication: { headline: "Name already in use" } });
  mount(<FinanceAccountEditor />);
  await screen.findByLabelText("Name");
  type("Name", "Bills");
  press("Save changes");
  const reads = h.api.listFinanceAccounts.mock.calls.length;
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(expect.stringContaining("Couldn’t confirm the save."), {
      id: "feedback",
    }),
  );
  // An unknown outcome also re-reads accounts.
  await waitFor(() => expect(h.api.listFinanceAccounts).toHaveBeenCalledTimes(reads + 1));
  press("Save changes");
  await waitFor(() =>
    expect(h.info).toHaveBeenCalledWith("Approve this change in Finance chat", { id: "feedback" }),
  );
  const [first, second] = h.api.updateFinanceAccount.mock.calls;
  expect(second[1]).toEqual(first[1]);
  press("Save changes");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith("Name already in use", { id: "feedback" }),
  );
  expect(h.success).not.toHaveBeenCalled();
  expect(h.back).not.toHaveBeenCalled();
});

it("renames a connected account whose provider balance is not a two-decimal amount", async () => {
  h.params = { id: linked.id };
  h.api.listFinanceAccounts.mockResolvedValue(accounts([{ ...linked, balance: 12.345 }]));
  h.api.updateFinanceAccount.mockResolvedValue(completed(linked));
  mount(<FinanceAccountEditor />);
  await screen.findByLabelText("Name");
  expect(screen.queryByLabelText("Balance")).toBeNull();
  type("Name", "Bills");
  press("Save changes");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Account updated", { id: "feedback" }),
  );
  expect(h.api.updateFinanceAccount.mock.calls[0][1]).not.toHaveProperty("balance");
});

it("says when the account to edit is unavailable", async () => {
  h.params = { id: "missing" };
  mount(<FinanceAccountEditor />);
  expect(await screen.findByText("This account is unavailable.")).toBeTruthy();
});

it("offers only the actions that apply to a manual account", async () => {
  h.params = { id: manual.id };
  mount(<FinanceAccountScreen />);
  fireEvent.click(await screen.findByRole("button", { name: "Edit account" }));
  expect(h.push).toHaveBeenCalledWith({
    pathname: "/finance-account-edit",
    params: { id: manual.id },
  });
  expect(screen.queryByRole("button", { name: "Sync account" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Stop tracking account" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Review duplicate" })).toBeNull();
});

it("syncs a connected account with one toast and refreshes its freshness", async () => {
  h.params = { id: linked.id };
  const provider = Promise.withResolvers<number>();
  h.api.syncFinanceAccount.mockReturnValueOnce(provider.promise).mockResolvedValue(0);
  mount(<FinanceAccountScreen />);
  fireEvent.click(await screen.findByRole("button", { name: "Sync account" }));
  expect(h.loading).toHaveBeenCalledWith("Syncing account…");
  // The provider handoff is pending: no second request and no early success.
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Sync account" })).toHaveProperty("disabled", true),
  );
  expect(h.success).not.toHaveBeenCalled();
  const reads = h.api.listFinanceAccounts.mock.calls.length;
  await act(async () => provider.resolve(3));
  expect(h.success).toHaveBeenCalledWith("Account synced. 3 records updated.", { id: "feedback" });
  expect(h.api.syncFinanceAccount).toHaveBeenCalledExactlyOnceWith(linked.id);
  await waitFor(() => expect(h.api.listFinanceAccounts.mock.calls.length).toBeGreaterThan(reads));
  press("Sync account");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Account synced. Nothing new from the institution.", {
      id: "feedback",
    }),
  );
  expect(h.loading).toHaveBeenCalledTimes(2);
  expectNoInlineResult();
});

it("separates a rejected sync from one whose outcome is unknown", async () => {
  h.params = { id: linked.id };
  h.api.syncFinanceAccount
    .mockRejectedValueOnce(rejection(409))
    .mockRejectedValueOnce(new Error("timeout"));
  mount(<FinanceAccountScreen />);
  fireEvent.click(await screen.findByRole("button", { name: "Sync account" }));
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "This account couldn’t sync. Check its status before retrying.",
      { id: "feedback" },
    ),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Sync account" })).toHaveProperty("disabled", false),
  );
  press("Sync account");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Couldn’t confirm the sync. It may still finish; check Updated before retrying.",
      { id: "feedback" },
    ),
  );
  expect(h.success).not.toHaveBeenCalled();
  expectNoInlineResult();
});

it("withholds sync from accounts that need reconnecting or already stopped tracking", async () => {
  h.params = { id: linked.id };
  h.api.listFinanceAccounts.mockResolvedValue(accounts([{ ...linked, status: "needs_reauth" }]));
  const view = mount(<FinanceAccountScreen />);
  await screen.findByRole("button", { name: "Stop tracking account" });
  expect(screen.queryByRole("button", { name: "Sync account" })).toBeNull();
  view.unmount();
  h.api.listFinanceAccounts.mockResolvedValue(
    accounts([
      {
        ...linked,
        synchronization: { ...synchronization, failureCode: "finance_account_disconnected" },
      },
    ]),
  );
  mount(<FinanceAccountScreen />);
  await screen.findByRole("button", { name: "Edit account" });
  expect(screen.queryByRole("button", { name: "Sync account" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Stop tracking account" })).toBeNull();
});

it("stops tracking an account only after explicit confirmation", async () => {
  h.params = { id: linked.id };
  h.api.disconnectFinanceAccount.mockResolvedValue(completed(linked));
  mount(<FinanceAccountScreen />);
  fireEvent.click(await screen.findByRole("button", { name: "Stop tracking account" }));
  expect(h.alert).toHaveBeenCalledWith(
    `Stop tracking ${linked.name}?`,
    expect.stringContaining("keep its ledger history"),
    expect.any(Array),
  );
  confirm("Keep connected");
  expect(h.api.disconnectFinanceAccount).not.toHaveBeenCalled();
  expect(h.loading).not.toHaveBeenCalled();
  confirm("Stop tracking");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Account tracking stopped. History preserved.", {
      id: "feedback",
    }),
  );
  expect(h.api.disconnectFinanceAccount).toHaveBeenCalledExactlyOnceWith(linked.id, {
    idempotencyKey: expect.any(String),
  });
  expect(h.loading).toHaveBeenCalledOnce();
  expectNoInlineResult();
});

it("reuses the stop-tracking key until the outcome is known", async () => {
  h.params = { id: linked.id };
  h.api.disconnectFinanceAccount
    .mockRejectedValueOnce(new Error("timeout"))
    .mockResolvedValueOnce({
      outcome: "failed",
      communication: { headline: "Account already stopped" },
    })
    .mockRejectedValueOnce(rejection(409));
  mount(<FinanceAccountScreen />);
  const stop = async () => {
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Stop tracking account" })).toHaveProperty(
        "disabled",
        false,
      ),
    );
    press("Stop tracking account");
    confirm("Stop tracking");
  };
  await screen.findByRole("button", { name: "Stop tracking account" });
  await stop();
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Couldn’t confirm tracking stopped. Check the account’s status before retrying.",
      { id: "feedback" },
    ),
  );
  await stop();
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith("Account already stopped", { id: "feedback" }),
  );
  await stop();
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Couldn’t stop tracking this account. It is still tracked.",
      { id: "feedback" },
    ),
  );
  const keys = h.api.disconnectFinanceAccount.mock.calls.map((call) => call[1].idempotencyKey);
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).not.toBe(keys[1]);
  expect(h.success).not.toHaveBeenCalled();
});

it("drops feedback for a sync that finishes after the screen closes", async () => {
  h.params = { id: linked.id };
  const provider = Promise.withResolvers<number>();
  h.api.syncFinanceAccount.mockReturnValue(provider.promise);
  const view = mount(<FinanceAccountScreen />);
  fireEvent.click(await screen.findByRole("button", { name: "Sync account" }));
  view.unmount();
  await act(async () => provider.resolve(1));
  expect(h.dismiss).toHaveBeenCalledWith("feedback");
  expect(h.success).not.toHaveBeenCalled();
});

it("opens duplicate review from the account actions", async () => {
  h.params = { id: linked.id };
  h.api.listFinanceAccounts.mockResolvedValue(accounts([linked, twin], [[linked.id, twin.id]]));
  mount(<FinanceAccountScreen />);
  fireEvent.click(await screen.findByRole("button", { name: "Review duplicate" }));
  expect(h.push).toHaveBeenCalledWith({
    pathname: "/finance-account-duplicate",
    params: { id: linked.id },
  });
});

it("resolves a duplicate after comparing both accounts and confirming", async () => {
  h.params = { id: linked.id };
  h.api.listFinanceAccounts.mockResolvedValue(accounts([linked, twin], [[linked.id, twin.id]]));
  h.api.getFinanceAccountDuplicatePreview.mockResolvedValue(completed(preview));
  h.api.resolveFinanceAccountDuplicate.mockResolvedValue(completed(linked));
  mount(<FinanceAccountDuplicate />);
  // The only eligible account is chosen, and source freshness stays visible.
  fireEvent.click(await screen.findByRole("button", { name: /Stop tracking duplicate/ }));
  expect(h.api.getFinanceAccountDuplicatePreview).toHaveBeenCalledWith(linked.id, twin.id);
  expect(screen.getByText("Keeping")).toBeTruthy();
  expect(screen.getAllByText(/Up to date/).length).toBe(2);
  expect(screen.getByText(/matching provider details/)).toBeTruthy();
  expect(h.alert).toHaveBeenCalledWith(
    `Stop tracking ${linked.name}?`,
    expect.stringContaining("2 transactions found only in"),
    expect.any(Array),
  );
  confirm("Keep both");
  expect(h.api.resolveFinanceAccountDuplicate).not.toHaveBeenCalled();
  confirm("Stop tracking");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith(
      "Duplicate tracking stopped. Transaction history preserved.",
      { id: "feedback" },
    ),
  );
  expect(h.api.resolveFinanceAccountDuplicate).toHaveBeenCalledExactlyOnceWith(linked.id, {
    keepAccountId: twin.id,
    revision,
    idempotencyKey: expect.any(String),
  });
  expect(h.loading).toHaveBeenCalledOnce();
  expect(h.back).toHaveBeenCalledOnce();
  expectNoInlineResult();
});

it("requires choosing which account to keep when several qualify", async () => {
  h.params = { id: linked.id };
  const third = { ...twin, id: "linked-3", name: "Checking (old login)" };
  h.api.listFinanceAccounts.mockResolvedValue(
    accounts([linked, twin, third], [[linked.id, twin.id, third.id]]),
  );
  h.api.getFinanceAccountDuplicatePreview.mockResolvedValue(
    completed({ ...preview, keptAccount: third, match: "possible" }),
  );
  mount(<FinanceAccountDuplicate />);
  await screen.findByText("Choose the account to keep before reviewing the comparison.");
  expect(h.api.getFinanceAccountDuplicatePreview).not.toHaveBeenCalled();
  const hint = (name: RegExp) =>
    screen.getByRole("button", { name }).getAttribute("aria-description");
  expect(hint(/Checking \(old login\)/)).toBe("Selects this as the account to keep tracking.");
  press(/Checking \(old login\)/);
  await screen.findByRole("button", { name: /Stop tracking duplicate/ });
  // The chosen row announces its selection; the other still offers to be chosen.
  expect(hint(/Checking \(old login\)/)).toBe("Selected as the account to keep tracking.");
  expect(hint(/Checking \(new login\)/)).toBe("Selects this as the account to keep tracking.");
  expect(h.api.getFinanceAccountDuplicatePreview).toHaveBeenCalledWith(linked.id, third.id);
  expect(screen.getByText(/may be duplicates/)).toBeTruthy();
});

it("reloads the comparison when the accounts changed before resolution", async () => {
  h.params = { id: linked.id };
  h.api.listFinanceAccounts.mockResolvedValue(accounts([linked, twin], [[linked.id, twin.id]]));
  h.api.getFinanceAccountDuplicatePreview
    .mockResolvedValueOnce(completed(preview))
    .mockResolvedValue(completed({ ...preview, revision: "c".repeat(64) }));
  h.api.resolveFinanceAccountDuplicate
    .mockRejectedValueOnce(rejection(409))
    .mockResolvedValue(completed(linked));
  mount(<FinanceAccountDuplicate />);
  fireEvent.click(await screen.findByRole("button", { name: /Stop tracking duplicate/ }));
  confirm("Stop tracking");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "These accounts changed, so nothing was stopped. Review the refreshed comparison.",
      { id: "feedback" },
    ),
  );
  expect(h.back).not.toHaveBeenCalled();
  await waitFor(() => expect(h.api.getFinanceAccountDuplicatePreview).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /Stop tracking duplicate/ })).toHaveProperty(
      "disabled",
      false,
    ),
  );
  press(/Stop tracking duplicate/);
  confirm("Stop tracking");
  await waitFor(() => expect(h.success).toHaveBeenCalled());
  const [first, second] = h.api.resolveFinanceAccountDuplicate.mock.calls;
  expect(second[1].revision).toBe("c".repeat(64));
  expect(second[1].idempotencyKey).not.toBe(first[1].idempotencyKey);
  expectNoInlineResult();
});

it("keeps the changed-accounts message for a conflict and words singular counts correctly", async () => {
  h.params = { id: linked.id };
  h.api.listFinanceAccounts.mockResolvedValue(accounts([linked, twin], [[linked.id, twin.id]]));
  h.api.getFinanceAccountDuplicatePreview.mockResolvedValue(
    completed({ ...preview, uniqueRedundantTransactionCount: 1 }),
  );
  h.api.resolveFinanceAccountDuplicate.mockRejectedValue(rejection(403));
  mount(<FinanceAccountDuplicate />);
  fireEvent.click(await screen.findByRole("button", { name: /Stop tracking duplicate/ }));
  expect(h.alert).toHaveBeenCalledWith(
    `Stop tracking ${linked.name}?`,
    expect.stringContaining(`1 transaction found only in ${linked.name} leaves planning.`),
    expect.any(Array),
  );
  confirm("Stop tracking");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Couldn’t stop tracking this duplicate. Nothing was stopped.",
      { id: "feedback" },
    ),
  );
  expect(h.back).not.toHaveBeenCalled();
  expectNoInlineResult();
});

it("retries an uncertain duplicate resolution with the same key", async () => {
  h.params = { id: linked.id };
  h.api.listFinanceAccounts.mockResolvedValue(accounts([linked, twin], [[linked.id, twin.id]]));
  h.api.getFinanceAccountDuplicatePreview.mockResolvedValue(completed(preview));
  h.api.resolveFinanceAccountDuplicate
    .mockRejectedValueOnce(new Error("timeout"))
    .mockResolvedValue({ outcome: "failed", communication: { headline: "Already resolved" } });
  mount(<FinanceAccountDuplicate />);
  fireEvent.click(await screen.findByRole("button", { name: /Stop tracking duplicate/ }));
  confirm("Stop tracking");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Couldn’t confirm tracking stopped. Check both accounts before retrying.",
      { id: "feedback" },
    ),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /Stop tracking duplicate/ })).toHaveProperty(
      "disabled",
      false,
    ),
  );
  press(/Stop tracking duplicate/);
  confirm("Stop tracking");
  await waitFor(() => expect(h.error).toHaveBeenCalledWith("Already resolved", { id: "feedback" }));
  const [first, second] = h.api.resolveFinanceAccountDuplicate.mock.calls;
  expect(second[1]).toEqual(first[1]);
  expect(h.success).not.toHaveBeenCalled();
  expect(h.back).not.toHaveBeenCalled();
});

it("explains why a duplicate cannot be resolved yet", async () => {
  h.params = { id: linked.id };
  h.api.listFinanceAccounts.mockResolvedValue(
    accounts(
      [linked, { ...twin, synchronization: { ...synchronization, state: "stale" } }],
      [[linked.id, twin.id]],
    ),
  );
  const view = mount(<FinanceAccountDuplicate />);
  await screen.findByText(/A connected account with current synchronization is required/);
  expect(screen.queryByRole("button", { name: /Stop tracking duplicate/ })).toBeNull();
  view.unmount();
  h.api.listFinanceAccounts.mockResolvedValue(accounts([linked, twin], [[linked.id, twin.id]]));
  h.api.getFinanceAccountDuplicatePreview.mockResolvedValue({
    outcome: "failed",
    data: null,
    communication: { headline: "These accounts are no longer comparable" },
  });
  const unavailable = mount(<FinanceAccountDuplicate />);
  await screen.findByText("These accounts are no longer comparable");
  expect(screen.queryByRole("button", { name: /Stop tracking duplicate/ })).toBeNull();
  unavailable.unmount();
  h.api.listFinanceAccounts.mockResolvedValue(accounts([linked, twin]));
  mount(<FinanceAccountDuplicate />);
  await screen.findByText(`${linked.name} no longer has a possible duplicate.`);
});
