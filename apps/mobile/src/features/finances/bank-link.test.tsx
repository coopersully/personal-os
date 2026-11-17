// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
  platform: "ios",
  link: {
    create: vi.fn(),
    open: vi.fn(),
    config: null as null | {
      token: string;
      onSuccess: (value: unknown) => void;
      onExit: (value: unknown) => void;
    },
  },
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
    getPlaidStatus: vi.fn(),
    getPlaidLinkToken: vi.fn(),
    exchangePlaidToken: vi.fn(),
    completePlaidReconnect: vi.fn(),
  },
}));
vi.mock("react-native-plaid-link-sdk", () => ({ createPlaidLinkSession: h.link.create }));
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
    Modal: ({ children }: PropsWithChildren) => <div role="dialog">{children}</div>,
    ActivityIndicator: ({ accessibilityLabel }: { accessibilityLabel?: string }) => (
      <span role="progressbar" aria-label={accessibilityLabel} />
    ),
    Alert: { alert: h.alert },
    Platform: {
      get OS() {
        return h.platform;
      },
    },
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
const linked = {
  id: "linked-1",
  name: "Everyday checking",
  institution: "Example bank",
  currencyCode: "USD",
  balance: 2400,
  includeInPlanning: true,
  kind: "cash",
  provider: "plaid",
  ownershipType: "individual",
  ownershipShare: 1,
  synchronization,
  status: "connected",
  accountMask: "1234",
  lastSyncedAt: "2026-11-12T12:00:00Z",
  createdAt: "2026-10-01T12:00:00Z",
  updatedAt: "2026-11-01T12:00:00Z",
};
const lapsed = { ...linked, status: "needs_reauth" };
const rejection = (status: number, message = "rejected") =>
  new ApiClientError({ code: "error", message, status });
function accounts(list: unknown[]) {
  return {
    accounts: list,
    totals: { cash: 0, netWorth: 0, debt: 0, investments: 0, otherAssets: 0 },
    accountSemantics: {
      possibleDuplicateGroups: [],
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
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
/** Action results are Sonner-only: no rendered copy may repeat a toast message. */
function expectNoInlineResult() {
  for (const toast of [h.error, h.success, h.info, h.loading])
    for (const [message] of toast.mock.calls as unknown[][])
      expect(screen.queryByText(String(message))).toBeNull();
}
/** What Plaid's Link reports once a person finishes signing in. */
const success = {
  publicToken: "public-sandbox-token",
  metadata: {
    institution: { id: "ins_109508", name: "First Platypus Bank" },
    accounts: [
      { id: "a", name: " Plaid Checking ", mask: "0000", type: "depository", subtype: {} },
      { id: "b", name: "Plaid Saving", type: "depository", subtype: {} },
      { id: "c", type: "depository", subtype: {} },
    ],
    linkSessionId: "session",
  },
};
const exit = (error?: unknown) => ({ error, metadata: { linkSessionId: "s", requestId: "r" } });
/** Waits for Link to be presented, then lets the person finish it. */
async function finishLink(result: "success" | "cancel" | "error") {
  await waitFor(() => expect(h.link.open).toHaveBeenCalledOnce());
  await act(async () => {
    if (result === "success") h.link.config?.onSuccess(success);
    else
      h.link.config?.onExit(
        result === "cancel"
          ? exit()
          : exit({
              errorCode: "INSTITUTION_DOWN",
              errorType: "INSTITUTION_ERROR",
              errorMessage: "provider canary",
              displayMessage: "provider display canary",
            }),
      );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of Object.values(h.api)) mock.mockReset();
  h.owner = "owner-a";
  h.platform = "ios";
  h.params = {};
  h.link.config = null;
  h.link.open.mockReset().mockResolvedValue(undefined);
  h.link.create.mockReset().mockImplementation(async (config) => {
    h.link.config = config;
    return { open: h.link.open };
  });
  h.api.listFinanceAccounts.mockResolvedValue(accounts([linked]));
  h.api.listFinanceTransactions.mockResolvedValue({ items: [], nextCursor: null });
  h.api.getPlaidStatus.mockResolvedValue({ available: true, environment: "sandbox" });
  h.api.getPlaidLinkToken.mockResolvedValue("link-sandbox-token");
});
afterEach(cleanup);

it("connects a bank through Plaid Link and reports the accounts the server confirmed", async () => {
  h.api.exchangePlaidToken.mockResolvedValue([linked, { ...linked, id: "linked-2" }]);
  mount(<FinanceAccountsScreen />);
  await screen.findByRole("button", { name: /Everyday checking/ });
  press("Connect a bank or card with Plaid");
  expect(h.loading).toHaveBeenCalledWith("Opening bank sign-in…");
  expect(screen.getByRole("button", { name: /Connect a bank/ })).toHaveProperty("disabled", true);
  await finishLink("success");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Connected 2 accounts.", { id: "feedback" }),
  );
  // A new connection asks for a token that is not tied to an account.
  expect(h.api.getPlaidLinkToken).toHaveBeenCalledWith(undefined);
  expect(h.link.config?.token).toBe("link-sandbox-token");
  // Only the public token, institution and account names and masks leave the device.
  expect(h.api.exchangePlaidToken).toHaveBeenCalledExactlyOnceWith({
    publicToken: "public-sandbox-token",
    institution: "First Platypus Bank",
    metadata: {
      institutionId: "ins_109508",
      accounts: [
        { name: "Plaid Checking", mask: "0000" },
        { name: "Plaid Saving", mask: null },
      ],
    },
  });
  expect(h.loading).toHaveBeenLastCalledWith("Connecting accounts…", { id: "feedback" });
  expect(h.api.completePlaidReconnect).not.toHaveBeenCalled();
  // The list is re-read after the connection.
  await waitFor(() => expect(h.api.listFinanceAccounts.mock.calls.length).toBeGreaterThan(1));
  expect(screen.getByRole("button", { name: /Connect a bank/ })).toHaveProperty("disabled", false);
  expectNoInlineResult();
});

it("says nothing was connected when the person closes Link", async () => {
  mount(<FinanceAccountsScreen />);
  await screen.findByRole("button", { name: /Everyday checking/ });
  press(/Connect a bank/);
  await finishLink("cancel");
  await waitFor(() =>
    expect(h.info).toHaveBeenCalledWith("Bank sign-in cancelled. Nothing was connected.", {
      id: "feedback",
    }),
  );
  expect(h.api.exchangePlaidToken).not.toHaveBeenCalled();
  expect(h.success).not.toHaveBeenCalled();
  expect(h.error).not.toHaveBeenCalled();
  expectNoInlineResult();
});

it("reports a provider error without exchanging anything or repeating Plaid's text", async () => {
  mount(<FinanceAccountsScreen />);
  await screen.findByRole("button", { name: /Everyday checking/ });
  press(/Connect a bank/);
  await finishLink("error");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith("Bank sign-in didn’t finish. Nothing was connected.", {
      id: "feedback",
    }),
  );
  expect(h.api.exchangePlaidToken).not.toHaveBeenCalled();
  expect(JSON.stringify(h.error.mock.calls)).not.toContain("canary");
  expect(h.success).not.toHaveBeenCalled();
  expectNoInlineResult();
});

it("shows the server's reason when it refuses the connection", async () => {
  h.api.exchangePlaidToken.mockRejectedValue(
    rejection(409, "These bank accounts are already connected."),
  );
  mount(<FinanceAccountsScreen />);
  await screen.findByRole("button", { name: /Everyday checking/ });
  press(/Connect a bank/);
  await finishLink("success");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Nothing was connected. These bank accounts are already connected.",
      { id: "feedback" },
    ),
  );
  expect(h.success).not.toHaveBeenCalled();
  expectNoInlineResult();
});

it("never repeats an exchange whose outcome is unknown", async () => {
  h.api.exchangePlaidToken.mockRejectedValue(new Error("network"));
  mount(<FinanceAccountsScreen />);
  await screen.findByRole("button", { name: /Everyday checking/ });
  press(/Connect a bank/);
  await finishLink("success");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Couldn’t confirm the connection. Check Accounts before connecting again.",
      { id: "feedback" },
    ),
  );
  expect(h.api.exchangePlaidToken).toHaveBeenCalledOnce();
  expect(h.success).not.toHaveBeenCalled();
  expectNoInlineResult();
});

it("does not open Link when the server has no bank connection or cannot issue a token", async () => {
  h.api.getPlaidStatus.mockResolvedValueOnce({ available: false });
  mount(<FinanceAccountsScreen />);
  await screen.findByRole("button", { name: /Everyday checking/ });
  press(/Connect a bank/);
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Bank connections aren’t set up on this server. Nothing was connected.",
      { id: "feedback" },
    ),
  );
  expect(h.api.getPlaidLinkToken).not.toHaveBeenCalled();
  h.api.getPlaidLinkToken.mockRejectedValueOnce(new Error("network"));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /Connect a bank/ })).toHaveProperty(
      "disabled",
      false,
    ),
  );
  press(/Connect a bank/);
  await waitFor(() =>
    expect(h.error).toHaveBeenLastCalledWith(
      "Couldn’t start bank sign-in. Nothing was connected.",
      { id: "feedback" },
    ),
  );
  expect(h.link.create).not.toHaveBeenCalled();
  expectNoInlineResult();
});

it("reports a native Link that cannot open", async () => {
  h.link.create.mockRejectedValue(new Error("native module missing"));
  mount(<FinanceAccountsScreen />);
  await screen.findByRole("button", { name: /Everyday checking/ });
  press(/Connect a bank/);
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Bank sign-in couldn’t open on this iPhone. Nothing was connected.",
      { id: "feedback" },
    ),
  );
  expect(h.api.exchangePlaidToken).not.toHaveBeenCalled();
  expectNoInlineResult();
});

it("drops the result when the signed-in person changes while Link is open", async () => {
  const view = mount(<FinanceAccountsScreen />);
  await screen.findByRole("button", { name: /Everyday checking/ });
  press(/Connect a bank/);
  await waitFor(() => expect(h.link.open).toHaveBeenCalledOnce());
  h.owner = "owner-b";
  view.rerender(
    <QueryClientProvider client={new QueryClient()}>
      <FinanceAccountsScreen />
    </QueryClientProvider>,
  );
  await act(async () => h.link.config?.onSuccess(success));
  await waitFor(() => expect(h.dismiss).toHaveBeenCalledWith("feedback"));
  expect(h.api.exchangePlaidToken).not.toHaveBeenCalled();
  expect(h.success).not.toHaveBeenCalled();
});

it("offers no bank connection outside the iPhone build", async () => {
  h.platform = "web";
  h.params = { id: linked.id };
  h.api.listFinanceAccounts.mockResolvedValue(accounts([lapsed]));
  const view = mount(<FinanceAccountsScreen />);
  await screen.findByRole("button", { name: /Everyday checking/ });
  expect(screen.queryByRole("button", { name: /Connect a bank/ })).toBeNull();
  view.unmount();
  mount(<FinanceAccountScreen />);
  await screen.findByText("Reconnect needed");
  expect(screen.queryByRole("button", { name: /Reconnect account/ })).toBeNull();
});

it("signs in again for an account that needs it and verifies with the server", async () => {
  h.params = { id: linked.id };
  h.api.listFinanceAccounts.mockResolvedValue(accounts([lapsed]));
  h.api.completePlaidReconnect.mockResolvedValue({
    accountId: linked.id,
    authorizationVerified: true,
    synchronizationScheduled: true,
  });
  mount(<FinanceAccountScreen />);
  await screen.findByText("Reconnect account");
  press(/Reconnect account/);
  await finishLink("success");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Bank sign-in verified. A sync is scheduled.", {
      id: "feedback",
    }),
  );
  // The token is issued for this account, which puts Link in update mode.
  expect(h.api.getPlaidLinkToken).toHaveBeenCalledWith(linked.id);
  expect(h.api.completePlaidReconnect).toHaveBeenCalledExactlyOnceWith(
    linked.id,
    expect.stringMatching(/^[0-9a-f-]{36}$/),
  );
  expect(h.api.exchangePlaidToken).not.toHaveBeenCalled();
  expect(h.loading).toHaveBeenLastCalledWith("Verifying bank sign-in…", { id: "feedback" });
  expectNoInlineResult();
});

it("keeps the reconnect key while the outcome is unknown and renews it after a refusal", async () => {
  h.params = { id: linked.id };
  h.api.listFinanceAccounts.mockResolvedValue(accounts([lapsed]));
  h.api.completePlaidReconnect
    .mockRejectedValueOnce(new Error("network"))
    .mockRejectedValueOnce(rejection(409, "This bank connection needs recovery."))
    .mockResolvedValueOnce({});
  mount(<FinanceAccountScreen />);
  await screen.findByText("Reconnect account");
  const attempt = async () => {
    h.link.open.mockClear();
    press(/Reconnect account/);
    await finishLink("success");
  };
  await attempt();
  await waitFor(() =>
    expect(h.error).toHaveBeenLastCalledWith(
      "Couldn’t confirm the bank sign-in was verified. Check the account’s status before trying again.",
      { id: "feedback" },
    ),
  );
  await attempt();
  await waitFor(() =>
    expect(h.error).toHaveBeenLastCalledWith(
      "Couldn’t verify this bank sign-in. This bank connection needs recovery.",
      { id: "feedback" },
    ),
  );
  await attempt();
  await waitFor(() => expect(h.success).toHaveBeenCalledOnce());
  const keys = h.api.completePlaidReconnect.mock.calls.map(([, key]) => key);
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).not.toBe(keys[1]);
  expectNoInlineResult();
});

it("leaves the account alone when reconnecting is cancelled or fails at the bank", async () => {
  h.params = { id: linked.id };
  h.api.listFinanceAccounts.mockResolvedValue(accounts([lapsed]));
  mount(<FinanceAccountScreen />);
  await screen.findByText("Reconnect account");
  press(/Reconnect account/);
  await finishLink("cancel");
  await waitFor(() =>
    expect(h.info).toHaveBeenCalledWith("Bank sign-in cancelled. Nothing changed.", {
      id: "feedback",
    }),
  );
  h.link.open.mockClear();
  press(/Reconnect account/);
  await finishLink("error");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith("Bank sign-in didn’t finish. Nothing changed.", {
      id: "feedback",
    }),
  );
  expect(h.api.completePlaidReconnect).not.toHaveBeenCalled();
  expectNoInlineResult();
});

it("offers reconnecting only for a connected bank account that needs sign-in", async () => {
  h.params = { id: linked.id };
  const view = mount(<FinanceAccountScreen />);
  await screen.findByRole("button", { name: "Edit account" });
  expect(screen.queryByText("Reconnect account")).toBeNull();
  view.unmount();
  h.api.listFinanceAccounts.mockResolvedValue(
    accounts([
      {
        ...lapsed,
        synchronization: { ...synchronization, failureCode: "finance_account_disconnected" },
      },
    ]),
  );
  mount(<FinanceAccountScreen />);
  await screen.findByRole("button", { name: "Edit account" });
  expect(screen.queryByText("Reconnect account")).toBeNull();
});
