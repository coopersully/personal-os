// @vitest-environment jsdom

import { ApiClientError, type CalendarAccount } from "@personal-os/api-client";
import {
  QueryClient,
  QueryClientProvider,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { toast } from "sonner";
import {
  CONNECTION_SNOOZE_MS,
  connectionProblems,
  financeConnectionProblems,
  readConnectionSnoozes,
} from "../features/connections/recovery-policy";
import { canRetryRead, useReadRecovery } from "../lib/read-recovery";
import { SettingsFeedbackContext, useSettingsError } from "../lib/settings-feedback";
import { AppRecovery } from "./app-recovery";
import { QueryFeedback } from "./async-state";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";

const mocks = vi.hoisted(() => ({ connectors: vi.fn(), finance: vi.fn(), mobile: false }));
vi.mock("../api", () => ({
  api: { listConnectors: mocks.connectors, listFinanceAccounts: mocks.finance },
}));
vi.mock("../hooks/use-mobile", () => ({ useIsMobile: () => mocks.mobile }));
vi.mock("sonner", () => ({
  useSonner: () => ({ toasts: [] }),
  toast: { loading: vi.fn(), dismiss: vi.fn(), error: vi.fn() },
}));
const clients: QueryClient[] = [];
const ready = { state: "ready", message: null, nextSyncAt: null, recovery: null } as const;
function account(
  state: CalendarAccount["health"]["state"] = "reconnect",
  id = "google",
): CalendarAccount {
  return {
    id,
    label: "Fixture Google",
    email: null,
    provider: "google",
    calendarEnabled: true,
    mailEnabled: true,
    lastSyncedAt: null,
    lastSyncAttemptAt: null,
    nextSyncAt: null,
    syncError: null,
    syncStatus: "error",
    health: { ...ready, state },
  };
}
function Location() {
  return <p>{useLocation().pathname + useLocation().search}</p>;
}
function setup(children = <Location />, owner: string | null = "person", blocked = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  clients.push(client);
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AppRecovery owner={owner ?? undefined} accountBlocked={blocked}>
          {children}
        </AppRecovery>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, ...view };
}
beforeEach(() => {
  mocks.mobile = false;
  mocks.connectors.mockResolvedValue([]);
  mocks.finance.mockResolvedValue({ accounts: [] });
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => {
    client.clear();
  });
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it("surfaces connection health at startup, prevents implicit dismissal and navigates to repair", async () => {
  mocks.connectors.mockResolvedValue([account()]);
  setup();
  const user = userEvent.setup();
  expect(await screen.findByRole("dialog", { name: "Check your connections" })).toHaveTextContent(
    "Fixture Google",
  );
  await user.keyboard("{Escape}");
  fireEvent.pointerDown(document.body);
  expect(screen.getByRole("dialog")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Review connections" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.getByText("/settings?page=connections")).toBeVisible();
});
it("persists snooze over remounts and reminds again after expiry", async () => {
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  mocks.connectors.mockResolvedValue([account()]);
  const first = setup();
  await userEvent
    .setup()
    .click(await screen.findByRole("button", { name: "Snooze for 15 minutes" }));
  first.unmount();
  setup();
  await waitFor(() => expect(mocks.connectors).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  now += CONNECTION_SNOOZE_MS + 1;
  fireEvent(document, new Event("visibilitychange"));
  expect(await screen.findByRole("dialog")).toBeVisible();
});
it("does not share snoozes between identities", async () => {
  mocks.connectors.mockResolvedValue([account()]);
  const first = setup();
  await userEvent
    .setup()
    .click(await screen.findByRole("button", { name: "Snooze for 15 minutes" }));
  first.unmount();
  setup(undefined, "someone-else");
  expect(await screen.findByRole("dialog")).toBeVisible();
});
it("surfaces a new problem during snooze and clears resolved reminders", async () => {
  mocks.connectors.mockResolvedValue([account("retrying")]);
  const { client } = setup();
  await userEvent
    .setup()
    .click(await screen.findByRole("button", { name: "Snooze for 15 minutes" }));
  await act(async () => client.setQueryData(["connectors"], [account()]));
  expect(await screen.findByRole("dialog")).toHaveTextContent("Reconnect this account");
  await act(async () => client.setQueryData(["connectors"], [account("ready")]));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await act(async () => client.setQueryData(["connectors"], [account("retrying")]));
  expect(await screen.findByRole("dialog")).toBeVisible();
});
it("works without storage access and does not confuse syncing or old timestamps with errors", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("disabled");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("disabled");
  });
  mocks.connectors.mockResolvedValue([account("service_attention")]);
  setup();
  await userEvent
    .setup()
    .click(await screen.findByRole("button", { name: "Snooze for 15 minutes" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(connectionProblems([account("ready"), account("syncing")])).toEqual([]);
});
it("uses a modal drawer on mobile and lets account recovery take priority", async () => {
  mocks.mobile = true;
  mocks.connectors.mockResolvedValue([account()]);
  const first = setup();
  const dialog = await screen.findByRole("dialog");
  expect(dialog).toHaveAttribute("data-slot", "drawer-content");
  expect(dialog).toHaveAttribute("data-vaul-drawer-direction", "bottom");
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  first.unmount();
  setup(undefined, "person", true);
  await waitFor(() => expect(mocks.connectors).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("keeps anonymous content usable without reading private connectors", () => {
  setup(<p>Sign in</p>, null);
  expect(screen.getByText("Sign in")).toBeVisible();
  expect(mocks.connectors).not.toHaveBeenCalled();
});
function Read({ fetcher }: { fetcher: () => Promise<string> }) {
  const query = useQuery({ queryKey: ["test-read"], queryFn: fetcher });
  return (
    <>
      <p>{query.data ?? "Loading"}</p>
      <QueryFeedback query={query} title="Couldn’t load records" />
    </>
  );
}
it("blocks failed reads, retries safely, and retains content until success without duplicate error copy", async () => {
  let succeed: (value: string) => void = () => {};
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error("private diagnostic"))
    .mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          succeed = resolve;
        }),
    );
  setup(<Read fetcher={fetcher} />);
  expect(await screen.findByRole("dialog", { name: "Let’s reconnect" })).toBeVisible();
  expect(screen.queryByText("private diagnostic")).not.toBeInTheDocument();
  expect(screen.queryByText("Couldn’t load records")).not.toBeInTheDocument();
  expect(toast.error).not.toHaveBeenCalled();
  await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
  expect(screen.getByRole("button", { name: "Trying again…" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  expect(screen.getByRole("button", { name: "Trying again…" })).toHaveFocus();
  expect(screen.getByRole("dialog")).toBeVisible();
  // aria-disabled preserves focus, so activation must also be guarded in the handler.
  fireEvent.click(screen.getByRole("button", { name: "Trying again…" }));
  expect(fetcher).toHaveBeenCalledTimes(2);
  await act(async () => succeed("Loaded records"));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.getByText("Loaded records")).toBeVisible();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("keeps retry failures in the gate with one loading-to-error toast", async () => {
  setup(<Read fetcher={vi.fn().mockRejectedValue(new Error("private"))} />);
  await userEvent.setup().click(await screen.findByRole("button", { name: "Try again" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn’t load your information. Try again.",
      expect.objectContaining({
        id: vi.mocked(toast.loading).mock.calls[0]?.[1]?.id,
        position: "top-center",
      }),
    ),
  );
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(screen.getByRole("button", { name: "Try again" })).toHaveFocus();
});
it("gives read recovery priority over connector reminders and recovers automatically", async () => {
  mocks.connectors.mockRejectedValue(new Error("unreachable"));
  const { client } = setup();
  expect(await screen.findByRole("dialog", { name: "Let’s reconnect" })).toBeVisible();
  await act(async () => client.setQueryData(["connectors"], [account()]));
  expect(await screen.findByRole("dialog", { name: "Check your connections" })).toBeVisible();
});
it("uses authoritative capability failures even when aggregate health is ready", () => {
  const value = account("ready");
  value.capabilities = {
    calendar: {
      health: account().health,
      lastAttemptAt: new Date().toISOString(),
      lastSyncedAt: null,
      failureCount: 1,
      errorCode: null,
      errorCategory: null,
      status: null,
    },
  };
  expect(connectionProblems([value])[0]?.state).toBe("reconnect");
  value.calendarEnabled = false;
  expect(connectionProblems([value])).toEqual([]);
});
it("rejects malformed snooze storage and excludes non-retryable access/validation responses", () => {
  for (const value of ["invalid", "[]", "null", '{"unbounded":1e100}']) {
    sessionStorage.setItem("key", value);
    expect(readConnectionSnoozes("key")).toEqual({});
  }
  sessionStorage.setItem("key", '{"good":123,"bad":"never"}');
  expect(readConnectionSnoozes("key")).toEqual({ good: 123 });
  for (const status of [401, 403, 404, 422])
    expect(canRetryRead(new ApiClientError({ status, code: "denied", message: "denied" }))).toBe(
      false,
    );
  expect(
    canRetryRead(new ApiClientError({ status: 503, code: "offline", message: "offline" })),
  ).toBe(true);
  expect(
    canRetryRead(new ApiClientError({ status: 429, code: "rate_limited", message: "slow down" })),
  ).toBe(true);
  expect(canRetryRead(new Error("offline"))).toBe(true);
});

it("surfaces financial sync freshness and routes to financial accounts", async () => {
  mocks.finance.mockResolvedValue({
    accounts: [
      {
        id: "bank",
        name: "Fixture Bank",
        provider: "plaid",
        status: "connected",
        synchronization: { state: "stale", recovery: null },
      },
    ],
  });
  setup();
  expect(await screen.findByRole("dialog")).toHaveTextContent("Fixture Bank");
  await userEvent.setup().click(screen.getByRole("link", { name: /Fixture Bank/ }));
  expect(screen.getByText("/finances/accounts")).toBeVisible();
});

it("deduplicates direct settings read hooks", async () => {
  function SettingsRead() {
    const query = useQuery({
      queryKey: ["settings-read"],
      queryFn: () => Promise.reject(new Error("read")),
    });
    useSettingsError(query.error, "Read failed");
    return null;
  }
  setup(
    <SettingsFeedbackContext.Provider value={true}>
      <SettingsRead />
    </SettingsFeedbackContext.Provider>,
  );
  expect(await screen.findByRole("dialog")).toBeVisible();
  expect(toast.error).not.toHaveBeenCalled();
});
it.each([
  "stale",
  "retrying",
  "blocked",
  "current",
] as const)("uses the Finance projection for %s without flagging manual accounts", (state) => {
  const value = {
    id: "bank",
    name: "Bank",
    provider: "plaid" as const,
    status: "connected" as const,
    synchronization: {
      state,
      recovery: null,
      failureCode: null,
      failureCount: 0,
      lastAttemptAt: null,
      lastSuccessAt: null,
      message: null,
      nextRetryAt: null,
    },
  };
  expect(financeConnectionProblems([value])).toHaveLength(state === "current" ? 0 : 1);
  expect(financeConnectionProblems([{ ...value, status: "manual" }])).toEqual([]);
  expect(financeConnectionProblems([{ ...value, status: "needs_reauth" }])[0]?.state).toBe(
    "reconnect",
  );
});
it("reopens after the snooze timer expires without requiring navigation", async () => {
  mocks.connectors.mockResolvedValue([account()]);
  setup();
  const button = await screen.findByRole("button", { name: "Snooze for 15 minutes" });
  vi.useFakeTimers();
  try {
    fireEvent.click(button);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONNECTION_SNOOZE_MS + 1);
    });
    expect(screen.getByRole("dialog", { name: "Check your connections" })).toBeVisible();
  } finally {
    vi.useRealTimers();
  }
});
it("does not announce a late retry failure after session teardown", async () => {
  let reject: (error: Error) => void = () => {};
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockImplementation(
      () =>
        new Promise<string>((_resolve, fail) => {
          reject = fail;
        }),
    );
  const view = setup(<Read fetcher={fetcher} />);
  await userEvent.setup().click(await screen.findByRole("button", { name: "Try again" }));
  view.unmount();
  await act(async () => reject(new Error("late failure")));
  expect(toast.error).not.toHaveBeenCalled();
});
it("leaves inactive query errors and unrelated action failures with their existing Sonner owner", async () => {
  const actionError = new Error("save failed");
  function InactiveRead() {
    const query = useQuery({
      queryKey: ["inactive"],
      queryFn: async () => "ignored",
      enabled: false,
    });
    useSettingsError(query.error, "Read unavailable");
    useSettingsError(actionError, "Couldn’t save settings");
    return null;
  }
  const { client } = setup(
    <SettingsFeedbackContext.Provider value={true}>
      <InactiveRead />
    </SettingsFeedbackContext.Provider>,
  );
  expect(toast.error).toHaveBeenCalledWith("Couldn’t save settings", expect.anything());
  await act(async () =>
    client
      .getQueryCache()
      .find({ queryKey: ["inactive"] })
      ?.setState({
        status: "error",
        error: new Error("disabled read"),
        errorUpdatedAt: Date.now(),
      }),
  );
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Read unavailable", expect.anything()),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("clears a repaired connector snooze even if Finance cannot be read", async () => {
  mocks.finance.mockRejectedValue(
    new ApiClientError({ status: 403, code: "forbidden", message: "no access" }),
  );
  mocks.connectors.mockResolvedValue([account()]);
  const { client } = setup();
  await userEvent
    .setup()
    .click(await screen.findByRole("button", { name: "Snooze for 15 minutes" }));
  await act(async () => client.setQueryData(["connectors"], [account("ready")]));
  await waitFor(() =>
    expect(
      Object.values(
        readConnectionSnoozes(`nohmi:connection-snooze:${window.location.origin}:person`),
      ),
    ).toEqual([]),
  );
  await act(async () => client.setQueryData(["connectors"], [account()]));
  expect(await screen.findByRole("dialog")).toBeVisible();
});
it("ends the snooze when signing out while preserving it across ordinary app reloads", async () => {
  mocks.connectors.mockResolvedValue([account()]);
  const { client, rerender } = setup();
  await userEvent
    .setup()
    .click(await screen.findByRole("button", { name: "Snooze for 15 minutes" }));
  const content = (owner: string | undefined) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AppRecovery owner={owner} accountBlocked={false}>
          <Location />
        </AppRecovery>
      </MemoryRouter>
    </QueryClientProvider>
  );
  rerender(content(undefined));
  rerender(content("person"));
  expect(await screen.findByRole("dialog", { name: "Check your connections" })).toBeVisible();
});

it("retries the failed next page with its original pagination direction", async () => {
  let failed = false;
  const fetcher = vi.fn(async ({ pageParam }: { pageParam: number }) => {
    if (pageParam === 2 && !failed) {
      failed = true;
      throw new Error("next page offline");
    }
    return pageParam;
  });
  function Pages() {
    const query = useInfiniteQuery({
      queryKey: ["pages"],
      queryFn: fetcher,
      initialPageParam: 1,
      getNextPageParam: (last) => last + 1,
    });
    return (
      <>
        <p>{query.data?.pages.join(",")}</p>
        <button
          type="button"
          onClick={() => {
            void query.fetchNextPage();
          }}
        >
          Load more
        </button>
      </>
    );
  }
  setup(<Pages />);
  await screen.findByText("1");
  await userEvent.setup().click(screen.getByRole("button", { name: "Load more" }));
  await userEvent.setup().click(await screen.findByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.getByText("1,2")).toBeVisible();
  expect(fetcher.mock.calls.map(([arg]) => arg.pageParam)).toEqual([1, 2, 2]);
});
it("identifies unlabeled accounts without rendering an unnamed repair link", () => {
  expect(
    connectionProblems([{ ...account(), label: "", email: "fixture@example.com" }])[0]?.label,
  ).toBe("fixture@example.com");
  expect(
    connectionProblems([{ ...account(), label: "", email: null, provider: "icloud" }])[0]?.label,
  ).toBe("Apple account");
});

it("queues a late-opening page dialog behind recovery", async () => {
  let openEditor = () => {};
  const fetcher = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue("ready");
  function Page() {
    const [open, setOpen] = useState(false);
    openEditor = () => setOpen(true);
    return (
      <>
        <Read fetcher={fetcher} />
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogTitle>Page editor</DialogTitle>
            <DialogDescription>Edit your details</DialogDescription>
            <input aria-label="Draft" />
          </DialogContent>
        </Dialog>
      </>
    );
  }
  setup(<Page />);
  await screen.findByRole("dialog", { name: "Let’s reconnect" });
  await act(async () => openEditor());
  expect(screen.queryByRole("dialog", { name: "Page editor" })).not.toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("dialog", { name: "Page editor" })).toBeVisible();
});
it("preserves an already-open editor and its draft beneath recovery", async () => {
  const fetcher = vi.fn().mockResolvedValue("ready");
  setup(
    <>
      <Read fetcher={fetcher} />
      <Dialog defaultOpen>
        <DialogContent>
          <DialogTitle>Existing editor</DialogTitle>
          <DialogDescription>Edit your draft</DialogDescription>
          <input aria-label="Draft" />
        </DialogContent>
      </Dialog>
    </>,
  );
  const editor = await screen.findByRole("dialog", { name: "Existing editor" });
  await userEvent.setup().type(screen.getByRole("textbox", { name: "Draft" }), "Keep my draft");
  fetcher.mockRejectedValueOnce(new Error("offline"));
  const client = clients.at(-1);
  await act(async () => {
    await client?.invalidateQueries({ queryKey: ["test-read"] });
  });
  expect(await screen.findByRole("dialog", { name: "Let’s reconnect" })).toBeVisible();
  expect(editor).toBeInTheDocument();
  expect(screen.getByDisplayValue("Keep my draft")).toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("dialog", { name: "Existing editor" })).toBeVisible();
  expect(screen.getByRole("textbox", { name: "Draft" })).toHaveValue("Keep my draft");
});

it("releases read recovery when disabled and does not retain a removed query", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const fetcher = vi.fn().mockRejectedValue(new Error("offline"));
  const { result, rerender } = renderHook(
    ({ enabled }) => {
      useQuery({ queryKey: ["recoverable"], queryFn: fetcher });
      return useReadRecovery(enabled);
    },
    {
      initialProps: { enabled: false },
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
  await waitFor(() => expect(client.getQueryState(["recoverable"])?.status).toBe("error"));
  expect(result.current).toEqual([]);
  rerender({ enabled: true });
  await waitFor(() => expect(result.current).toHaveLength(1));
  rerender({ enabled: false });
  expect(result.current).toEqual([]);
  rerender({ enabled: true });
  await waitFor(() => expect(result.current).toHaveLength(1));
  fetcher.mockResolvedValue("recovered");
  await act(async () => client.removeQueries({ queryKey: ["recoverable"] }));
  await waitFor(() => expect(result.current).toEqual([]));
});

it("leaves installation-owned read failures with their own feedback and recovery", async () => {
  function InstallationRead() {
    const query = useQuery({
      queryKey: ["installation-status"],
      queryFn: () => Promise.reject(new Error("native status unavailable")),
      meta: { sessionIndependent: true },
    });
    useSettingsError(query.error, "Couldn’t check installation");
    return null;
  }
  setup(
    <SettingsFeedbackContext.Provider value={true}>
      <InstallationRead />
    </SettingsFeedbackContext.Provider>,
  );
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Couldn’t check installation", expect.anything()),
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("hands a retry that becomes forbidden back to the access correction flow", async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockRejectedValue(
      new ApiClientError({ status: 403, code: "forbidden", message: "access revoked" }),
    );
  setup(<Read fetcher={fetcher} />);
  await userEvent.setup().click(await screen.findByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(screen.getByText("Couldn’t load records")).toBeVisible();
});

it("still signs out safely when the browser refuses snooze removal", async () => {
  mocks.connectors.mockResolvedValue([account()]);
  const { client, rerender } = setup();
  await userEvent
    .setup()
    .click(await screen.findByRole("button", { name: "Snooze for 15 minutes" }));
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
    throw new Error("unavailable");
  });
  rerender(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AppRecovery owner={undefined} accountBlocked={false}>
          <p>Signed out</p>
        </AppRecovery>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(screen.getByText("Signed out")).toBeVisible();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it.each([
  ["service_attention", "A service issue is preventing updates."],
  ["retrying", "Sync is delayed. nohmi is retrying automatically."],
] as const)("explains %s without asking users to reconnect valid credentials", async (state, copy) => {
  mocks.connectors.mockResolvedValue([{ ...account(state), label: "", email: null }]);
  setup();
  const dialog = await screen.findByRole("dialog", { name: "Check your connections" });
  expect(dialog).toHaveTextContent("Google account");
  expect(dialog).toHaveTextContent(copy);
  expect(dialog).not.toHaveTextContent("Reconnect this account");
});

it("recovers a failed read in the mobile drawer without showing connection choices", async () => {
  mocks.mobile = true;
  const fetcher = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue("Ready");
  setup(<Read fetcher={fetcher} />);
  const dialog = await screen.findByRole("dialog", { name: "Let’s reconnect" });
  expect(dialog).toHaveAttribute("data-slot", "drawer-content");
  expect(screen.queryByRole("button", { name: "Snooze for 15 minutes" })).not.toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.getByText("Ready")).toBeVisible();
});

it("clears repaired reminders in memory when storage stops accepting writes", async () => {
  mocks.connectors.mockResolvedValue([account()]);
  const { client } = setup();
  await userEvent
    .setup()
    .click(await screen.findByRole("button", { name: "Snooze for 15 minutes" }));
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("unavailable");
  });
  await act(async () => client.setQueryData(["connectors"], [account("ready")]));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await act(async () => client.setQueryData(["connectors"], [account()]));
  expect(await screen.findByRole("dialog", { name: "Check your connections" })).toBeVisible();
});

it.each([
  "finance_account_disconnected",
  "finance_account_legacy_disconnected",
])("keeps deliberately stopped Finance accounts out of automatic recovery (%s)", async (failureCode) => {
  const stopped = {
    id: "stopped-bank",
    name: "Stopped duplicate",
    provider: "plaid" as const,
    status: "needs_reauth" as const,
    synchronization: {
      state: "blocked" as const,
      recovery: "reconnect" as const,
      failureCode,
      failureCount: 0,
      lastAttemptAt: null,
      lastSuccessAt: null,
      message: null,
      nextRetryAt: null,
    },
  };
  expect(financeConnectionProblems([stopped])).toEqual([]);
  mocks.finance.mockResolvedValue({ accounts: [stopped] });
  const { client } = setup();
  await waitFor(() => expect(client.getQueryState(["finance-accounts"])?.status).toBe("success"));
  expect(screen.queryByRole("dialog", { name: "Check your connections" })).not.toBeInTheDocument();

  const expired = {
    ...stopped,
    id: "active-bank",
    name: "Active bank needing consent",
    synchronization: { ...stopped.synchronization, failureCode: "ITEM_LOGIN_REQUIRED" },
  };
  await act(async () =>
    client.setQueryData(["finance-accounts"], { accounts: [stopped, expired] }),
  );
  const dialog = await screen.findByRole("dialog", { name: "Check your connections" });
  expect(dialog).toHaveTextContent("Active bank needing consent");
  expect(dialog).toHaveTextContent("Reconnect this account");
  expect(dialog).not.toHaveTextContent("Stopped duplicate");

  await act(async () =>
    client.setQueryData(["finance-accounts"], {
      accounts: [
        stopped,
        { ...expired, synchronization: { ...expired.synchronization, failureCode } },
      ],
    }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Check your connections" }),
    ).not.toBeInTheDocument(),
  );
});
