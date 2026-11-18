// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PropsWithChildren, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FinanceAutomationRegistrationScreen } from "./automation-registration";
import { FinanceAutomationsScreen } from "./automations";

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
  replace: vi.fn(),
  setParams: vi.fn(),
  back: vi.fn(),
  alert: vi.fn(),
  platform: "ios",
  screen: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  dismiss: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(() => "feedback"),
  api: {
    listAutomationHostSchedules: vi.fn(),
    listAutomationHostConnections: vi.fn(),
    createAutomationHostSchedule: vi.fn(),
    bindAutomationHostSchedule: vi.fn(),
    updateAutomationHostSchedule: vi.fn(),
    cancelAutomationHostSchedule: vi.fn(),
    revokeAutomationHostSchedule: vi.fn(),
  },
}));
vi.mock("react-native", () => {
  const Box = ({
    children,
    testID,
    accessibilityLabel,
  }: PropsWithChildren<{ testID?: string; accessibilityLabel?: string }>) => (
    <div data-testid={testID} title={accessibilityLabel}>
      {children}
    </div>
  );
  return {
    StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
    AppState: { currentState: "active", addEventListener: () => ({ remove: vi.fn() }) },
    Keyboard: { addListener: () => ({ remove: vi.fn() }) },
    useWindowDimensions: () => ({ height: 852, width: 393 }),
    Image: () => null,
    View: Box,
    ScrollView: Box,
    Text: Box,
    Modal: ({ children, visible }: PropsWithChildren<{ visible?: boolean }>) =>
      visible ? <div role="dialog">{children}</div> : null,
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
    Switch: ({
      accessibilityLabel,
      value,
      onValueChange,
      disabled,
    }: {
      accessibilityLabel?: string;
      value: boolean;
      onValueChange: (value: boolean) => void;
      disabled?: boolean;
    }) => (
      <input
        type="checkbox"
        aria-label={accessibilityLabel}
        checked={value}
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.checked)}
      />
    ),
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
        {typeof children === "function" ? null : children}
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

const SCHEDULE = "a0000000-0000-4000-8000-000000000001";
const OTHER = "a0000000-0000-4000-8000-000000000002";
const CONNECTION = "b0000000-0000-4000-8000-000000000001";
const READ_ONLY = "b0000000-0000-4000-8000-000000000002";
const ZONE = "America/New_York";

type State = "setup_pending" | "active" | "paused" | "cancelled" | "revoked";
const codex = {
  hostSurface: "codex_desktop",
  trigger: {
    type: "recurring",
    recurrence: { type: "interval", everyMinutes: 1440, timeZone: ZONE },
  },
};
const claudeScheduled = {
  hostSurface: "claude_code_routine",
  trigger: { type: "scheduled", localTimes: ["08:00", "20:00"], timeZone: ZONE },
};
const claudeEvent = {
  hostSurface: "claude_code_routine",
  trigger: { type: "event", expectedMaximumLatencyMinutes: 5 },
};
function status(state: State, change: { schedule?: object; health?: object } = {}) {
  const bound = state === "active" || state === "paused" || state === "revoked";
  return {
    connectionAvailable: true,
    schedule: {
      id: SCHEDULE,
      tenantAuthorizationConnectionId: CONNECTION,
      label: "Morning check",
      effectiveScopes: ["finances:maintain"],
      lastObservedAt: null,
      version: 4,
      createdAt: "2026-11-01T12:00:00.000Z",
      updatedAt: "2026-11-01T12:00:00.000Z",
      ...codex,
      hostAutomationId: bound ? "codex-1" : null,
      state,
      nextExpectedAt: null,
      ...change.schedule,
    },
    health: {
      state: state === "active" ? "expected" : state,
      lastObservedAt: null,
      nextExpectedAt: null,
      observedAt: "2026-11-18T12:00:00.000Z",
      repairOwner: null,
      graceMilliseconds: null,
      overdueAt: null,
      ...change.health,
    },
  };
}
const connections = [
  { id: CONNECTION, label: "Desk Mac", scopes: ["finances:read", "finances:maintain"] },
  { id: READ_ONLY, label: "Read only", scopes: ["finances:read"] },
];
const rejection = (code: number, message = "rejected") =>
  new ApiClientError({ code: "error", message, status: code });
function mount(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}
async function list(...statuses: unknown[]) {
  h.api.listAutomationHostSchedules.mockResolvedValue(statuses);
  mount(<FinanceAutomationsScreen />);
  await screen.findByText("Register automation");
  await waitFor(() => expect(screen.queryByRole("progressbar")).toBeNull());
}
async function form() {
  mount(<FinanceAutomationRegistrationScreen />);
  await screen.findByRole("button", { name: /^Authorized connection,/ });
}
/** Presses a button of the most recent native confirmation. */
function confirm(label: string) {
  const buttons = h.alert.mock.calls.at(-1)?.[2] as { text: string; onPress?: () => void }[];
  act(() => buttons.find((item) => item.text === label)?.onPress?.());
}
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const button = (name: string | RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;
function pick(row: RegExp, option: string | RegExp) {
  press(row);
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: option }));
}
/** The value shown beside a row's title. */
const rowValue = (title: string) => screen.getByText(title).nextElementSibling?.textContent;
/** Action results are Sonner-only: no rendered copy may repeat a toast message. */
function expectNoInlineResult() {
  for (const toast of [h.error, h.success, h.info, h.loading])
    for (const [message] of toast.mock.calls)
      expect(screen.queryByText(String(message))).toBeNull();
}

beforeEach(() => {
  h.owner = "owner-a";
  h.timezone = ZONE;
  h.api.listAutomationHostSchedules.mockResolvedValue([]);
  h.api.listAutomationHostConnections.mockResolvedValue(connections);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  for (const mock of Object.values(h.api)) mock.mockReset();
});

// List

it("lists each registration with its state, next expected start and last observation", async () => {
  await list(
    status("active", {
      health: {
        state: "expected",
        nextExpectedAt: "2026-11-19T13:00:00.000Z",
        lastObservedAt: "2026-11-18T13:05:00.000Z",
      },
    }),
  );
  expect(screen.getByText("Morning check")).toBeTruthy();
  expect(rowValue("State")).toBe("Active");
  expect(rowValue("Next expected start")).toMatch(/Nov 19, 2026, 8:00/);
  expect(rowValue("Last observed")).toMatch(/Nov 18, 2026, 8:05/);
  expect(screen.getByText("Codex desktop · Every 1440 minutes · America/New_York")).toBeTruthy();
  expect(screen.queryByText("Overdue")).toBeNull();
  // What stays on the web is said once, in plain copy.
  expect(
    screen.getByText("Fire tokens, host prompts and run recovery are managed on the web."),
  ).toBeTruthy();
  expect(h.error).not.toHaveBeenCalled();
});

it("marks a registration overdue only when its health says so", async () => {
  await list(
    status("active", {
      health: { state: "overdue", nextExpectedAt: "2026-11-17T13:00:00.000Z" },
    }),
  );
  expect(rowValue("Check-in")).toBe("Overdue");
  expect(rowValue("Last observed")).toBe("Not reported");
  expect(
    screen.getByText(
      "This host missed its expected check-in. Check that the external job is enabled and connected.",
    ),
  ).toBeTruthy();
});

it("labels a start projected from a declared daily cadence as projected", async () => {
  await list(
    status("active", {
      schedule: { ...claudeScheduled, nextExpectedAt: "2026-11-19T13:00:00.000Z" },
      health: { nextExpectedAt: "2026-11-19T13:00:00.000Z" },
    }),
    status("setup_pending", { schedule: { id: OTHER, label: "On reply", ...claudeEvent } }),
  );
  expect(rowValue("Projected next start")).toMatch(/Nov 19, 2026, 8:00/);
  expect(
    screen.getByText("Claude routine · Daily at 08:00 and 20:00 · America/New_York"),
  ).toBeTruthy();
  expect(screen.getByText("Claude routine · Event-based · next run unknown")).toBeTruthy();
  expect(rowValue("Next expected start")).toBe("Not reported");
});

it("says so when nothing is registered and opens the registration form", async () => {
  await list();
  expect(screen.getByText("No Finance automations registered.")).toBeTruthy();
  press(/Register automation/);
  expect(h.push).toHaveBeenCalledWith("/finance-automation-new");
});

// Rename

it("renames a registration and shows the name the server lists", async () => {
  await list(status("active"));
  press("Rename Morning check");
  expect(button("Save name").disabled).toBe(true);
  type("Name", "  Evening check ");
  h.api.updateAutomationHostSchedule.mockResolvedValue(status("active"));
  h.api.listAutomationHostSchedules.mockResolvedValue([
    status("active", { schedule: { label: "Evening check", version: 5 } }),
  ]);
  press("Save name");
  expect(h.loading).toHaveBeenCalledWith("Saving automation…");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Automation name saved.", expect.any(Object)),
  );
  expect(h.api.updateAutomationHostSchedule).toHaveBeenCalledExactlyOnceWith(SCHEDULE, {
    expectedVersion: 4,
    label: "Evening check",
  });
  await screen.findByText("Evening check");
  expect(screen.queryByLabelText("Name")).toBeNull();
  expectNoInlineResult();
});

it("announces a confirmed write without waiting for the list to be read again", async () => {
  await list(status("active"));
  press("Rename Morning check");
  type("Name", "Evening check");
  h.api.updateAutomationHostSchedule.mockResolvedValue(status("active"));
  const reread = Promise.withResolvers<unknown[]>();
  h.api.listAutomationHostSchedules.mockReturnValue(reread.promise);
  press("Save name");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Automation name saved.", expect.any(Object)),
  );
  // The list is still the one read before: it is not rewritten, and nothing is sent against it.
  expect(screen.getByText("Morning check")).toBeTruthy();
  expect(button("Remove registration of Morning check").disabled).toBe(true);
  await act(async () =>
    reread.resolve([status("active", { schedule: { label: "Evening check", version: 5 } })]),
  );
  await screen.findByText("Evening check");
  expect(button("Remove registration of Evening check").disabled).toBe(false);
  expect(h.success).toHaveBeenCalledTimes(1);
});

it.each([
  "cancelled",
  "revoked",
] as const)("offers nothing to change on a %s registration", async (state) => {
  await list(status(state));
  expect(screen.queryByRole("button", { name: /^Rename/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /^Cancel setup/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /^Remove registration/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /^Enter host automation ID/ })).toBeNull();
});

// Cancel and remove

it("cancels only a registration that is still being set up, after a confirmation", async () => {
  await list(status("setup_pending"));
  expect(screen.queryByRole("button", { name: /^Remove registration/ })).toBeNull();
  press("Cancel setup of Morning check");
  expect(h.api.cancelAutomationHostSchedule).not.toHaveBeenCalled();
  expect(h.alert.mock.calls.at(-1)?.[0]).toBe("Cancel this setup?");
  h.api.cancelAutomationHostSchedule.mockResolvedValue(status("cancelled"));
  h.api.listAutomationHostSchedules.mockResolvedValue([
    status("cancelled", { schedule: { version: 5 } }),
  ]);
  confirm("Cancel setup");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Setup cancelled.", expect.any(Object)),
  );
  expect(h.api.cancelAutomationHostSchedule).toHaveBeenCalledExactlyOnceWith(SCHEDULE, {
    expectedVersion: 4,
    expectedState: "setup_pending",
  });
  expect(rowValue("State")).toBe("Cancelled");
  expectNoInlineResult();
});

it.each([
  "active",
  "paused",
] as const)("removes a %s registration after a destructive confirmation", async (state) => {
  await list(status(state));
  expect(screen.queryByRole("button", { name: /^Cancel setup/ })).toBeNull();
  press("Remove registration of Morning check");
  const [title, , buttons] = h.alert.mock.calls.at(-1) as [
    string,
    string,
    { text: string; style?: string }[],
  ];
  expect(title).toBe("Remove this registration?");
  expect(buttons.find((item) => item.text === "Remove registration")?.style).toBe("destructive");
  expect(h.api.revokeAutomationHostSchedule).not.toHaveBeenCalled();
  h.api.revokeAutomationHostSchedule.mockResolvedValue(status("revoked"));
  h.api.listAutomationHostSchedules.mockResolvedValue([status("revoked")]);
  confirm("Remove registration");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith(
      "Registration removed. Stop the external job in its host.",
      expect.any(Object),
    ),
  );
  expect(h.api.revokeAutomationHostSchedule).toHaveBeenCalledExactlyOnceWith(SCHEDULE, {
    expectedVersion: 4,
    expectedState: state,
  });
  expect(rowValue("State")).toBe("Revoked");
  expectNoInlineResult();
});

// Bind

it("binds a Codex registration to its host automation ID and next run", async () => {
  await list(status("setup_pending"));
  press("Enter host automation ID for Morning check");
  expect(button("Save host automation ID").disabled).toBe(true);
  type("Host automation ID", " codex-42 ");
  // A Codex job also reports when it next runs.
  expect(button("Save host automation ID").disabled).toBe(true);
  type("Next run (ISO date/time)", "2026-11-19T08:00:00-05:00");
  h.api.bindAutomationHostSchedule.mockResolvedValue(status("active"));
  h.api.listAutomationHostSchedules.mockResolvedValue([
    status("active", {
      schedule: { version: 5 },
      health: { nextExpectedAt: "2026-11-19T13:00:00.000Z" },
    }),
  ]);
  press("Save host automation ID");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Host automation ID saved.", expect.any(Object)),
  );
  expect(h.api.bindAutomationHostSchedule).toHaveBeenCalledExactlyOnceWith(SCHEDULE, {
    hostSurface: "codex_desktop",
    expectedVersion: 4,
    expectedState: "setup_pending",
    hostAutomationId: "codex-42",
    nextExpectedAt: "2026-11-19T13:00:00.000Z",
  });
  expect(rowValue("State")).toBe("Active");
  expect(screen.queryByRole("button", { name: /^Enter host automation ID/ })).toBeNull();
  expectNoInlineResult();
});

it("binds a Claude routine by its identifier alone", async () => {
  await list(status("setup_pending", { schedule: claudeScheduled }));
  press("Enter host automation ID for Morning check");
  expect(screen.queryByLabelText("Next run (ISO date/time)")).toBeNull();
  type("Host automation ID", "routine-7");
  h.api.bindAutomationHostSchedule.mockResolvedValue(status("active"));
  press("Save host automation ID");
  await waitFor(() => expect(h.api.bindAutomationHostSchedule).toHaveBeenCalled());
  expect(h.api.bindAutomationHostSchedule).toHaveBeenCalledExactlyOnceWith(SCHEDULE, {
    hostSurface: "claude_code_routine",
    expectedVersion: 4,
    expectedState: "setup_pending",
    hostAutomationId: "routine-7",
  });
});

// Outcomes

it("shows the state the server lists, not the state a write asked for", async () => {
  await list(status("setup_pending"));
  press("Cancel setup of Morning check");
  // The write resolves, but the list read afterwards still reports setup pending.
  h.api.cancelAutomationHostSchedule.mockResolvedValue(status("cancelled"));
  confirm("Cancel setup");
  await waitFor(() => expect(h.success).toHaveBeenCalled());
  expect(h.api.listAutomationHostSchedules).toHaveBeenCalledTimes(2);
  expect(rowValue("State")).toBe("Setup pending");
  expect(screen.getByRole("button", { name: "Cancel setup of Morning check" })).toBeTruthy();
});

it("says a registration changed elsewhere and reads the list again", async () => {
  await list(status("active"));
  press("Rename Morning check");
  type("Name", "Evening check");
  h.api.updateAutomationHostSchedule.mockRejectedValue(rejection(409));
  h.api.listAutomationHostSchedules.mockResolvedValue([
    status("paused", { schedule: { version: 7 } }),
  ]);
  press("Save name");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "This automation changed elsewhere. Nothing was saved; its latest state is shown.",
      expect.any(Object),
    ),
  );
  await waitFor(() => expect(rowValue("State")).toBe("Paused"));
  // The next write carries the version that was read again.
  h.api.updateAutomationHostSchedule.mockResolvedValue(status("paused"));
  press("Save name");
  await waitFor(() => expect(h.api.updateAutomationHostSchedule).toHaveBeenCalledTimes(2));
  expect(h.api.updateAutomationHostSchedule).toHaveBeenLastCalledWith(SCHEDULE, {
    expectedVersion: 7,
    label: "Evening check",
  });
  expectNoInlineResult();
});

it.each([
  [
    "cancel",
    () => {
      press("Cancel setup of Morning check");
      confirm("Cancel setup");
    },
    "cancelAutomationHostSchedule",
  ],
  [
    "bind",
    () => {
      press("Enter host automation ID for Morning check");
      type("Host automation ID", "codex-42");
      type("Next run (ISO date/time)", "2026-11-19T08:00:00-05:00");
      press("Save host automation ID");
    },
    "bindAutomationHostSchedule",
  ],
] as const)("reports a %s that changed elsewhere", async (_name, run, method) => {
  await list(status("setup_pending"));
  h.api[method].mockRejectedValue(rejection(409));
  run();
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "This automation changed elsewhere. Nothing was saved; its latest state is shown.",
      expect.any(Object),
    ),
  );
  expect(h.api.listAutomationHostSchedules).toHaveBeenCalledTimes(2);
});

it("reports a refused or unconfirmed write once and never sends it again", async () => {
  await list(status("active"));
  press("Remove registration of Morning check");
  h.api.revokeAutomationHostSchedule.mockRejectedValueOnce(rejection(403, "Not allowed."));
  confirm("Remove registration");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith("Automation not saved. Not allowed.", expect.any(Object)),
  );
  press("Remove registration of Morning check");
  h.api.revokeAutomationHostSchedule.mockRejectedValueOnce(new TypeError("Network request failed"));
  confirm("Remove registration");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Couldn’t confirm the automation was saved. Check its state before trying again.",
      expect.any(Object),
    ),
  );
  expect(h.api.revokeAutomationHostSchedule).toHaveBeenCalledTimes(2);
  // Still active: nothing but the list says otherwise.
  expect(rowValue("State")).toBe("Active");
  await waitFor(() => expect(h.api.listAutomationHostSchedules).toHaveBeenCalledTimes(3));
  expectNoInlineResult();
});

it("offers a retry when the registrations cannot load", async () => {
  h.api.listAutomationHostSchedules.mockRejectedValue(rejection(500));
  mount(<FinanceAutomationsScreen />);
  await screen.findByRole("button", { name: /Retry loading/ });
  expect(screen.queryByText("No Finance automations registered.")).toBeNull();
});

// Registration

it("registers a Codex schedule through a connection allowed to maintain Finance", async () => {
  await form();
  expect(field("Name").value).toBe("Finance maintenance");
  expect(field("Time zone").value).toBe(ZONE);
  expect(button("Register expected schedule").disabled).toBe(true);
  // Only a connection that carries finances:maintain can be chosen.
  press(/^Authorized connection,/);
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).queryByRole("button", { name: "Read only" })).toBeNull();
  fireEvent.click(within(dialog).getByRole("button", { name: "Desk Mac" }));
  expect(button("Register expected schedule").disabled).toBe(false);

  type("Name", " Nightly check ");
  h.api.createAutomationHostSchedule.mockResolvedValue(status("setup_pending"));
  press("Register expected schedule");
  expect(h.loading).toHaveBeenCalledWith("Saving automation…");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith(
      "Automation registered. Set it up in your host.",
      expect.any(Object),
    ),
  );
  expect(h.api.createAutomationHostSchedule).toHaveBeenCalledExactlyOnceWith({
    label: "Nightly check",
    tenantAuthorizationConnectionId: CONNECTION,
    requestedScopes: ["finances:maintain"],
    hostSurface: "codex_desktop",
    trigger: {
      type: "recurring",
      recurrence: { type: "interval", everyMinutes: 1440, timeZone: ZONE },
    },
  });
  expect(h.back).toHaveBeenCalledTimes(1);
  expectNoInlineResult();
});

it("registers a Claude routine with daily local times", async () => {
  await form();
  pick(/^Authorized connection,/, "Desk Mac");
  pick(/^Host,/, /daily local times/);
  expect(field("Daily local times").value).toBe("08:00, 20:00");
  type("Daily local times", "7:00");
  expect(button("Register expected schedule").disabled).toBe(true);
  type("Daily local times", "07:00, 19:30");
  type("Time zone", "Europe/Paris");
  h.api.createAutomationHostSchedule.mockResolvedValue(status("setup_pending"));
  press("Register expected schedule");
  await waitFor(() => expect(h.api.createAutomationHostSchedule).toHaveBeenCalled());
  expect(h.api.createAutomationHostSchedule).toHaveBeenCalledExactlyOnceWith({
    label: "Finance maintenance",
    tenantAuthorizationConnectionId: CONNECTION,
    requestedScopes: ["finances:maintain"],
    hostSurface: "claude_code_routine",
    trigger: { type: "scheduled", localTimes: ["07:00", "19:30"], timeZone: "Europe/Paris" },
  });
});

it("registers an event-triggered Claude routine without a time zone", async () => {
  await form();
  pick(/^Authorized connection,/, "Desk Mac");
  pick(/^Host,/, /event trigger/);
  expect(screen.queryByLabelText("Time zone")).toBeNull();
  expect(field("Maximum event latency in minutes").value).toBe("5");
  type("Maximum event latency in minutes", "61");
  expect(button("Register expected schedule").disabled).toBe(true);
  type("Maximum event latency in minutes", "10");
  h.api.createAutomationHostSchedule.mockResolvedValue(status("setup_pending"));
  press("Register expected schedule");
  await waitFor(() => expect(h.api.createAutomationHostSchedule).toHaveBeenCalled());
  expect(h.api.createAutomationHostSchedule).toHaveBeenCalledExactlyOnceWith({
    label: "Finance maintenance",
    tenantAuthorizationConnectionId: CONNECTION,
    requestedScopes: ["finances:maintain"],
    hostSurface: "claude_code_routine",
    trigger: { type: "event", expectedMaximumLatencyMinutes: 10 },
  });
});

it("requires a name, a time zone and a valid interval", async () => {
  await form();
  pick(/^Authorized connection,/, "Desk Mac");
  type("Name", "  ");
  expect(button("Register expected schedule").disabled).toBe(true);
  type("Name", "Nightly check");
  type("Time zone", " ");
  expect(button("Register expected schedule").disabled).toBe(true);
  type("Time zone", ZONE);
  for (const minutes of ["0", "10081", "1.5", ""]) {
    type("Interval in minutes", minutes);
    expect(button("Register expected schedule").disabled).toBe(true);
  }
  type("Interval in minutes", "60");
  expect(button("Register expected schedule").disabled).toBe(false);
});

it("says when no connection may maintain Finance", async () => {
  h.api.listAutomationHostConnections.mockResolvedValue([connections[1]]);
  await form();
  expect(
    screen.getByText("Connect a host with Finance maintenance permission before registering."),
  ).toBeTruthy();
  expect(button("Register expected schedule").disabled).toBe(true);
});

it("treats an unconfirmed registration that the list now shows as registered", async () => {
  await form();
  pick(/^Authorized connection,/, "Desk Mac");
  h.api.createAutomationHostSchedule.mockRejectedValueOnce(rejection(504));
  h.api.listAutomationHostSchedules.mockResolvedValue([
    status("setup_pending", { schedule: { id: "schedule-new", label: "Finance maintenance" } }),
  ]);
  press("Register expected schedule");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith(
      "Automation registered. Set it up in your host.",
      expect.any(Object),
    ),
  );
  expect(h.error).not.toHaveBeenCalled();
  expect(h.api.createAutomationHostSchedule).toHaveBeenCalledTimes(1);
  expect(h.back).toHaveBeenCalledTimes(1);
  expectNoInlineResult();
});

it("does not mistake a registration that was already listed for the unconfirmed one", async () => {
  h.api.listAutomationHostSchedules.mockResolvedValue([
    status("setup_pending", { schedule: { label: "Finance maintenance" } }),
  ]);
  await form();
  pick(/^Authorized connection,/, "Desk Mac");
  h.api.createAutomationHostSchedule.mockRejectedValueOnce(rejection(504));
  press("Register expected schedule");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Couldn’t confirm the automation was saved. Check its state before trying again.",
      expect.any(Object),
    ),
  );
  expect(h.success).not.toHaveBeenCalled();
  expect(h.back).not.toHaveBeenCalled();
  // The list was read again and holds nothing new, so registering is open again.
  await waitFor(() => expect(button("Register expected schedule").disabled).toBe(false));
});

it("keeps registering closed after an unconfirmed result until the list has been read again", async () => {
  await form();
  pick(/^Authorized connection,/, "Desk Mac");
  h.api.createAutomationHostSchedule.mockRejectedValueOnce(new TypeError("Network request failed"));
  h.api.listAutomationHostSchedules.mockRejectedValue(rejection(500));
  press("Register expected schedule");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Couldn’t confirm the automation was saved. Check its state before trying again.",
      expect.any(Object),
    ),
  );
  const check = await screen.findByRole("button", { name: /Check automations/ });
  expect(button("Register expected schedule").disabled).toBe(true);
  h.loading.mockClear();
  fireEvent.click(check);
  expect(h.loading).toHaveBeenCalledExactlyOnceWith("Checking automations…");
  await waitFor(() =>
    expect(h.error).toHaveBeenLastCalledWith(
      "Couldn’t read your automations. Check again before registering.",
      expect.any(Object),
    ),
  );
  expect(button("Register expected schedule").disabled).toBe(true);
  // Read again with nothing new: registering opens, and the earlier request is not replayed.
  h.api.listAutomationHostSchedules.mockResolvedValue([]);
  press(/Check automations/);
  await waitFor(() =>
    expect(h.info).toHaveBeenCalledWith(
      "That registration isn’t listed. You can register it again.",
      expect.any(Object),
    ),
  );
  expect(button("Register expected schedule").disabled).toBe(false);
  expect(screen.queryByRole("button", { name: /Check automations/ })).toBeNull();
  expect(h.api.createAutomationHostSchedule).toHaveBeenCalledTimes(1);
  expect(h.back).not.toHaveBeenCalled();
  expectNoInlineResult();
});

it("finds the unconfirmed registration on a later check and leaves the form", async () => {
  await form();
  pick(/^Authorized connection,/, "Desk Mac");
  h.api.createAutomationHostSchedule.mockRejectedValueOnce(rejection(502));
  h.api.listAutomationHostSchedules.mockRejectedValue(rejection(500));
  press("Register expected schedule");
  const check = await screen.findByRole("button", { name: /Check automations/ });
  h.api.listAutomationHostSchedules.mockResolvedValue([
    status("setup_pending", { schedule: { id: "schedule-new", label: "Finance maintenance" } }),
  ]);
  fireEvent.click(check);
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith(
      "Automation registered. Set it up in your host.",
      expect.any(Object),
    ),
  );
  expect(h.api.createAutomationHostSchedule).toHaveBeenCalledTimes(1);
  expect(h.back).toHaveBeenCalledTimes(1);
});

it("keeps the form open when registration is refused or not confirmed", async () => {
  await form();
  pick(/^Authorized connection,/, "Desk Mac");
  h.api.createAutomationHostSchedule.mockRejectedValueOnce(rejection(400, "Use a real time zone."));
  press("Register expected schedule");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Automation not saved. Use a real time zone.",
      expect.any(Object),
    ),
  );
  h.api.createAutomationHostSchedule.mockRejectedValueOnce(rejection(504));
  press("Register expected schedule");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Couldn’t confirm the automation was saved. Check its state before trying again.",
      expect.any(Object),
    ),
  );
  expect(h.api.createAutomationHostSchedule).toHaveBeenCalledTimes(2);
  expect(h.back).not.toHaveBeenCalled();
  expectNoInlineResult();
});
