// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  mailboxes: vi.fn(),
  calendars: vi.fn(),
  accounts: vi.fn(),
  rituals: vi.fn(),
  success: vi.fn(),
  assign: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("sonner", () => ({
  toast: { dismiss: vi.fn(), error: vi.fn(), loading: vi.fn(), success: mocks.success },
}));
vi.mock("../../api.js", () => ({
  api: {
    listMailboxes: mocks.mailboxes,
    listCalendars: mocks.calendars,
    listConnectors: mocks.accounts,
    listRituals: mocks.rituals,
  },
  errorMessage: (error: unknown) =>
    error instanceof Error ? error.message : "Something went wrong.",
}));

import { type DesktopSettings, type DesktopStatus, hostedServer } from "./bridge.js";
import { DesktopSettingsPanel } from "./settings.js";

let settings: DesktopSettings;
let status: DesktopStatus;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function mount(props: Parameters<typeof DesktopSettingsPanel>[0] = {}) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rendered = render(
    <QueryClientProvider client={cache}>
      <MemoryRouter>
        <DesktopSettingsPanel {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  if (props.connectionOnly)
    fireEvent.click(screen.getByRole("button", { name: "Server settings" }));
  return { ...rendered, cache };
}
async function save() {
  const connect = screen.queryByRole("button", { name: "Connect to server" });
  if (connect && !connect.hasAttribute("disabled")) await userEvent.click(connect);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith("desktop_save_settings", expect.anything()),
  );
  return mocks.invoke.mock.calls
    .filter(([command]) => command === "desktop_save_settings")
    .at(-1)?.[1].settings as DesktopSettings;
}
beforeEach(() => {
  vi.resetAllMocks();
  settings = {
    serverUrl: hostedServer,
    launchAtLogin: false,
    petEnabled: false,
    petColor: "#c7d23c",
    petWorkspaces: ["tasks", "reminders", "calendar"],
    widgetWorkspaces: ["tasks", "reminders", "calendar"],
    notifications: {
      enabled: false,
      tasks: true,
      reminders: true,
      calendar: true,
      mail: false,
      advanceMinutes: 10,
      sound: true,
      preview: false,
      quietStart: null,
      quietEnd: null,
      mailAccountIds: [],
      calendarIds: [],
    },
  };
  status = {
    settings,
    hostedServer,
    native: {
      notificationPermission: "denied",
      testNotificationStatus: "accepted",
      loginStatus: "notRegistered",
      widgetsAvailable: false,
    },
  };
  mocks.invoke.mockImplementation(
    async (command: string, args?: { settings?: DesktopSettings }) => {
      if (command === "ritual_local") return { enabled: false };
      if (command === "desktop_settings") return status;
      if (command === "desktop_save_settings") {
        status = { ...status, settings: args!.settings! };
        return status;
      }
      return { ok: true };
    },
  );
  mocks.rituals.mockResolvedValue({ rituals: [] });
  mocks.accounts.mockResolvedValue([{ id: "account-1", email: "cooper@example.com" }]);
  mocks.mailboxes.mockResolvedValue([
    { accountId: "account-1" },
    { accountId: "account-1" },
    { accountId: "account-2" },
  ]);
  mocks.calendars.mockResolvedValue([{ id: "calendar-1", name: "Personal" }]);
  const original = window;
  vi.stubGlobal(
    "window",
    new Proxy(original, {
      get(target, property) {
        if (property === "location") return { assign: mocks.assign };
        return Reflect.get(target, property, target);
      },
      has(target, property) {
        return property === "__TAURI_INTERNALS__" || Reflect.has(target, property);
      },
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("desktop preferences", () => {
  it("does not render desktop settings or request native data in a browser", () => {
    vi.unstubAllGlobals();
    const { container } = mount();
    expect(container).toBeEmptyDOMElement();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("keeps server choices off the login page until explicitly opened", async () => {
    const cache = new QueryClient();
    render(
      <QueryClientProvider client={cache}>
        <DesktopSettingsPanel connectionOnly />
      </QueryClientProvider>,
    );
    expect(screen.queryByText("Recommended")).not.toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Server settings" }));
    expect(await screen.findByRole("dialog", { name: "Server connection" })).toBeInTheDocument();
    expect(await screen.findByText("Recommended")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Server settings" })).toHaveFocus();
  });

  it("promotes hosted nohmi and keeps custom server controls in an advanced disclosure", async () => {
    mount({ connectionOnly: true });
    expect(await screen.findByText("Recommended")).toBeInTheDocument();
    expect(screen.getByText("nohmi-api.coopersully.me")).toBeInTheDocument();
    expect(screen.queryByLabelText("Custom API server")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Advanced server settings" }));
    expect(screen.getByLabelText("Custom API server")).toHaveValue("");
  });

  it("refreshes fresh cached settings on remount before showing the current server controls", async () => {
    const cache = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 15_000 } },
    });
    const panel = (
      <QueryClientProvider client={cache}>
        <DesktopSettingsPanel connectionOnly />
      </QueryClientProvider>
    );
    const first = render(panel);
    fireEvent.click(screen.getByRole("button", { name: "Server settings" }));
    expect(await screen.findByText("Recommended")).toBeInTheDocument();
    first.unmount();

    const refresh = deferred<DesktopStatus>();
    mocks.invoke.mockReturnValueOnce(refresh.promise);
    const remounted = render(panel);
    fireEvent.click(screen.getByRole("button", { name: "Server settings" }));
    await waitFor(() =>
      expect(
        mocks.invoke.mock.calls.filter(([command]) => command === "desktop_settings"),
      ).toHaveLength(2),
    );
    expect(screen.queryByText("Recommended")).not.toBeInTheDocument();

    await act(async () =>
      refresh.resolve({
        ...status,
        settings: { ...settings, serverUrl: "https://current-account.example.com" },
      }),
    );
    expect(await screen.findByLabelText("Custom API server")).toHaveValue(
      "https://current-account.example.com",
    );
    expect(screen.getByRole("button", { name: "Test connection" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Connect to server" })).toBeDisabled();
    remounted.unmount();
    cache.clear();
  });

  it("allows custom server testing and switching before login without authenticated queries", async () => {
    const { cache } = mount({ connectionOnly: true });
    await screen.findByText("Recommended");
    await userEvent.click(screen.getByRole("button", { name: "Advanced server settings" }));
    const server = screen.getByLabelText("Custom API server");
    cache.setQueryData(["private"], "previous account");
    expect(screen.queryByRole("switch", { name: "Open at login" })).not.toBeInTheDocument();
    fireEvent.change(server, { target: { value: "https://custom.example.com" } });
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText("Connection verified")).toBeInTheDocument();
    expect(mocks.invoke).toHaveBeenCalledWith("desktop_test_connection", {
      serverUrl: "https://custom.example.com",
    });
    expect((await save()).serverUrl).toBe("https://custom.example.com");
    await waitFor(() => expect(cache.getQueryData(["private"])).toBeUndefined());
    expect(mocks.assign).not.toHaveBeenCalled();
    expect(mocks.mailboxes).not.toHaveBeenCalled();
    expect(mocks.calendars).not.toHaveBeenCalled();
    expect(mocks.accounts).not.toHaveBeenCalled();
  });

  it("invalidates the connection test when the address changes or Hosted nohmi is selected", async () => {
    mount({ connectionOnly: true });
    await screen.findByText("Recommended");
    await userEvent.click(screen.getByRole("button", { name: "Advanced server settings" }));
    const server = screen.getByLabelText("Custom API server");
    fireEvent.change(server, { target: { value: "https://custom.example.com" } });
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await screen.findByText("Connection verified");
    fireEvent.change(server, { target: { value: "https://other.example.com" } });
    expect(screen.queryByText("Connection verified")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Use hosted nohmi" }));
    expect(server).toHaveValue("");
    expect(screen.queryByText("Connection verified")).not.toBeInTheDocument();
  });

  it("saves login and widget choices independently from pet and notification settings", async () => {
    mount();
    await screen.findByText("Recommended");
    expect(screen.getByText("Keep nohmi active")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: "Open at login" }));
    const finance = document.getElementById("widget-finances");
    const tasks = document.getElementById("widget-tasks");
    expect(finance).not.toBeNull();
    expect(tasks).not.toBeNull();
    await userEvent.click(finance as HTMLElement);
    await userEvent.click(tasks as HTMLElement);
    const saved = await save();
    expect(saved.launchAtLogin).toBe(true);
    expect(saved.widgetWorkspaces).toEqual(["reminders", "calendar", "finances"]);
    expect(saved.petWorkspaces).toEqual(settings.petWorkspaces);
    expect(saved.notifications).toEqual(settings.notifications);
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.assign).not.toHaveBeenCalled();
  });

  it("saves pet appearance and workspace visibility while preserving widget privacy", async () => {
    mount({ section: "pet" });
    await screen.findByRole("switch", { name: "Show desktop pet" });
    await userEvent.click(screen.getByRole("switch", { name: "Show desktop pet" }));
    fireEvent.change(screen.getByLabelText("Pet color"), { target: { value: "#123456" } });
    await userEvent.click(screen.getByRole("checkbox", { name: "Tasks" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Finances" }));
    await userEvent.click(screen.getByRole("button", { name: "Reset pet position" }));
    expect(mocks.invoke).toHaveBeenCalledWith("desktop_native_action", {
      action: "reset_pet_position",
    });
    const saved = await save();
    expect(saved).toMatchObject({
      petEnabled: true,
      petColor: "#123456",
      petWorkspaces: ["reminders", "calendar", "finances"],
    });
    expect(saved.widgetWorkspaces).toEqual(settings.widgetWorkspaces);
    expect(saved.notifications).toEqual(settings.notifications);
  });

  it("autosaves pet scale with keyboard controls while preserving color", async () => {
    mount({ section: "pet" });
    const slider = await screen.findByRole("slider", { name: "Pet scale" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    await waitFor(() => expect(status.settings.petScale).toBe(1.05));
    expect(status.settings.petColor).toBe(settings.petColor);
  });

  it("keeps draft notification choices when requesting permission refreshes native status", async () => {
    status.native.notificationPermission = "notDetermined";
    mount({ section: "notifications" });
    await screen.findByRole("switch", { name: "Enable notifications" });
    await userEvent.click(screen.getByRole("switch", { name: "Enable notifications" }));
    status = { ...status, native: { ...status.native, notificationPermission: "authorized" } };
    await userEvent.click(screen.getByRole("button", { name: "Allow notifications" }));
    expect(await screen.findByText("macOS permission: authorized")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Enable notifications" })).toBeChecked();
    expect(mocks.invoke).toHaveBeenCalledWith("desktop_native_action", {
      action: "request_notification_permission",
    });
    for (const [label, action] of [
      ["Test notification", "test_notification"],
      ["macOS notification settings", "open_notification_settings"],
    ] as const) {
      await userEvent.click(screen.getByRole("button", { name: label }));
      expect(mocks.invoke).toHaveBeenCalledWith("desktop_native_action", { action });
    }
  });

  it("reports notification tests through Sonner without adding inline result text", async () => {
    status.native.notificationPermission = "authorized";
    mount({ section: "notifications" });
    const button = await screen.findByRole("button", { name: "Test notification" });
    expect(toast.success).not.toHaveBeenCalled(); // Cached status is not a new action.
    await userEvent.click(button);
    expect(toast.loading).toHaveBeenCalledWith("Sending test to macOS…", expect.anything());
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "macOS accepted the test notification.",
        expect.objectContaining({ description: expect.stringContaining("screen sharing") }),
      ),
    );
    expect(vi.mocked(toast.success).mock.calls.at(-1)?.[1]?.id).toBe(
      vi.mocked(toast.loading).mock.calls.at(-1)?.[1]?.id,
    );
    expect(screen.queryByText(/macOS accepted the test/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Sending test to macOS/)).not.toBeInTheDocument();
  });

  it("reports native test failures through Sonner without an inline action alert", async () => {
    status.native.notificationPermission = "authorized";
    status.native.testNotificationStatus = "failed";
    mount({ section: "notifications" });
    await userEvent.click(await screen.findByRole("button", { name: "Test notification" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(vi.mocked(toast.error).mock.calls.at(-1)?.[1]?.id).toBe(
      vi.mocked(toast.loading).mock.calls.at(-1)?.[1]?.id,
    );
    expect(toast.success).not.toHaveBeenCalled();
    const errorMessage = vi.mocked(toast.error).mock.calls.at(-1)?.[0];
    expect(screen.queryByText(String(errorMessage))).not.toBeInTheDocument();
  });

  it("opens macOS settings after denial and prevents tests until authorized", async () => {
    mount({ section: "notifications" });
    await userEvent.click(await screen.findByRole("button", { name: "Allow in macOS settings" }));
    expect(mocks.invoke).toHaveBeenCalledWith("desktop_native_action", {
      action: "open_notification_settings",
    });
    expect(screen.getByRole("button", { name: "Test notification" })).toBeDisabled();
  });

  it("keeps permission requests pending until the native result arrives", async () => {
    status.native.notificationPermission = "notDetermined";
    status.native.notificationPermissionPending = true;
    mount({ section: "notifications" });
    expect(await screen.findByRole("button", { name: "Waiting for macOS…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Test notification" })).toBeDisabled();
  });

  it("autosaves workspace choices independently and keeps global controls separate", async () => {
    let view = mount({ section: "notifications" });
    await screen.findByRole("switch", { name: "Enable notifications" });
    expect(screen.queryByRole("switch", { name: "Tasks due" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save preferences" })).not.toBeInTheDocument();
    for (const workspace of ["Calendar", "Tasks", "Mail", "Finances"]) {
      const id = workspace.toLowerCase();
      expect(
        screen.getByRole("link", { name: `${workspace} Notification settings` }),
      ).toHaveAttribute("href", `/settings?section=${id}&field=${id}:notifications`);
    }
    for (const label of [
      "Enable notifications",
      "Play notification sounds",
      "Show message previews",
    ])
      await userEvent.click(screen.getByRole("switch", { name: label }));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "22:00" } });
    fireEvent.change(screen.getByLabelText("Until"), { target: { value: "07:00" } });
    await waitFor(() => expect(status.settings.notifications.quietEnd).toBe("07:00"));
    view.unmount();
    view = mount({ section: "tasks" });
    await userEvent.click(await screen.findByRole("switch", { name: "Tasks due" }));
    await userEvent.click(screen.getByRole("switch", { name: "Reminders due" }));
    await waitFor(() => expect(status.settings.notifications.reminders).toBe(false));
    view.unmount();
    view = mount({ section: "calendar" });
    await userEvent.click(await screen.findByRole("switch", { name: "Upcoming events" }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Personal" }));
    fireEvent.change(screen.getByLabelText("Minutes before an event"), { target: { value: "30" } });
    await waitFor(() => expect(status.settings.notifications.advanceMinutes).toBe(30));
    view.unmount();
    mount({ section: "mail" });
    await userEvent.click(await screen.findByRole("switch", { name: "New mail" }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "cooper@example.com" }));
    await waitFor(() =>
      expect(status.settings.notifications.mailAccountIds).toEqual(["account-1"]),
    );
    expect(status.settings.notifications).toEqual({
      enabled: true,
      tasks: false,
      reminders: false,
      calendar: false,
      mail: true,
      advanceMinutes: 30,
      sound: false,
      preview: true,
      quietStart: "22:00",
      quietEnd: "07:00",
      mailAccountIds: ["account-1"],
      calendarIds: ["calendar-1"],
    });
  });

  it("rolls back failed automatic saves and lets the next change retry", async () => {
    mount({ section: "pet" });
    await screen.findByLabelText("Pet color");
    const original = mocks.invoke.getMockImplementation()!;
    let fail = true;
    mocks.invoke.mockImplementation(async (command, args) => {
      if (command === "desktop_save_settings" && fail) throw new Error("Could not write");
      return original(command, args);
    });
    fireEvent.change(screen.getByLabelText("Pet color"), { target: { value: "#123456" } });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByLabelText("Pet color")).toHaveValue(settings.petColor.toUpperCase()),
    );
    expect(mocks.success).not.toHaveBeenCalled();
    fail = false;
    fireEvent.change(screen.getByLabelText("Pet color"), { target: { value: "#123456" } });
    await waitFor(() => expect(status.settings.petColor).toBe("#123456"));
  });

  it("offers retry when loading desktop settings fails", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("Keychain unavailable"));
    mount();
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringMatching(/Couldn’t load desktop preferences/),
        expect.objectContaining({ action: expect.objectContaining({ label: "Try again" }) }),
      ),
    );
    const retry = vi.mocked(toast.error).mock.calls.at(-1)?.[1]?.action;
    if (!retry || typeof retry !== "object" || !("onClick" in retry))
      throw new Error("Missing Sonner retry");
    render(
      <button type="button" onClick={retry.onClick}>
        Retry settings
      </button>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry settings" }));
    expect(await screen.findByText("Recommended")).toBeInTheDocument();
  });

  it("shows actual native limitations alongside widget availability", async () => {
    status = {
      ...status,
      wallpaperError: "Could not download images",
      native: { error: "Login registration needs approval", widgetsAvailable: true },
    };
    mount();
    expect(await screen.findByText(/Check macOS permissions/)).toBeInTheDocument();
    expect(screen.getByText(/Wallpaper could not refresh/)).toBeInTheDocument();
    expect(
      screen.getByText("Native widgets are available through Edit Widgets on your desktop."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Login item:/)).not.toBeInTheDocument();
  });

  it("shows connection progress and a failed test without verifying or saving it", async () => {
    mount({ connectionOnly: true });
    await screen.findByText("Recommended");
    const test = deferred<never>();
    mocks.invoke.mockReturnValueOnce(test.promise);
    await userEvent.click(screen.getByRole("button", { name: "Test hosted connection" }));
    expect(screen.getByRole("button", { name: "Testing hosted…" })).toBeDisabled();
    await act(async () => test.reject(new Error("This is a website, not a nohmi API")));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "Couldn’t test the desktop connection. Try again.",
        expect.any(Object),
      ),
    );
    expect(screen.queryByText("Connection verified")).not.toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalledWith("desktop_save_settings", expect.anything());
  });

  it("serializes rapid changes without overwriting newer preferences", async () => {
    mount({ section: "notifications" });
    await screen.findByRole("switch", { name: "Enable notifications" });
    const write = deferred<DesktopStatus>();
    const original = mocks.invoke.getMockImplementation()!;
    let first = true;
    mocks.invoke.mockImplementation(async (command, args) => {
      if (command === "desktop_save_settings" && first) {
        first = false;
        await write.promise;
      }
      return original(command, args);
    });
    await userEvent.click(screen.getByRole("switch", { name: "Enable notifications" }));
    await userEvent.click(screen.getByRole("switch", { name: "Play notification sounds" }));
    await userEvent.click(screen.getByRole("switch", { name: "Show message previews" }));
    expect(
      mocks.invoke.mock.calls.filter(([command]) => command === "desktop_save_settings"),
    ).toHaveLength(1);
    await act(async () => write.resolve(status));
    await waitFor(() =>
      expect(status.settings.notifications).toMatchObject({
        enabled: true,
        sound: false,
        preview: true,
      }),
    );
    expect(screen.getByRole("switch", { name: "Show message previews" })).toBeChecked();
  });

  it("loads account failures only in their owning workspace", async () => {
    mocks.mailboxes.mockRejectedValue(new Error("Offline"));
    mocks.calendars.mockRejectedValue(new Error("Offline"));
    mocks.accounts.mockRejectedValue(new Error("Offline"));
    const global = mount({ section: "notifications" });
    await screen.findByRole("switch", { name: "Enable notifications" });
    expect(mocks.mailboxes).not.toHaveBeenCalled();
    expect(mocks.calendars).not.toHaveBeenCalled();
    global.unmount();
    const mail = mount({ section: "mail" });
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Couldn’t load mail accounts.", expect.anything()),
    );
    expect(screen.queryByText("Couldn’t load mail accounts.")).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "New mail" })).toBeEnabled();
    mail.unmount();
    mount({ section: "calendar" });
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Couldn’t load calendars.", expect.anything()),
    );
    expect(screen.queryByText("Couldn’t load calendars.")).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Upcoming events" })).toBeEnabled();
  });

  it("explains mail refresh retries and which account needs reconnection", async () => {
    status = { ...status, mailError: "Activity feed unavailable" };
    mocks.accounts.mockResolvedValue([
      {
        id: "account-1",
        email: "cooper@example.com",
        syncError: "Provider authorization expired",
      },
      { id: "account-2", email: "healthy@example.com", syncError: null },
    ]);
    mount({ section: "mail" });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Mail notifications could not refresh. nohmi will retry while running.",
    );
    expect(
      await screen.findByText(
        "cooper@example.com: Sync needs attention. Check Connections to reconnect.",
      ),
    ).toHaveAttribute("role", "status");
    expect(screen.queryByText(/healthy@example\.com:/)).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "healthy@example.com" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Save preferences" })).not.toBeInTheDocument();
  });

  it("removes both quiet-hour boundaries when the inputs are cleared", async () => {
    settings.notifications.quietStart = "22:00";
    settings.notifications.quietEnd = "07:00";
    mount({ section: "notifications" });
    await screen.findByLabelText("From");
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Until"), { target: { value: "" } });
    const saved = await save();
    expect(saved.notifications.quietStart).toBeNull();
    expect(saved.notifications.quietEnd).toBeNull();
  });
});

it("exposes pending ritual recovery in signed-out connection settings", async () => {
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "desktop_settings") return status;
    if (command === "ritual_local")
      return {
        recovery: true,
        queue: [{ value: "Private answer" }],
        localHistory: [],
        enabled: false,
      };
    return { ok: true };
  });
  mount({ connectionOnly: true });
  expect(await screen.findByRole("button", { name: "Export pending changes" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Discard pending changes" })).toBeInTheDocument();
  expect(screen.queryByText(/Private answer/)).not.toBeInTheDocument();
});

describe("background setup", () => {
  it("reports readiness only after OS approval and both morning settings are enabled", async () => {
    settings.petEnabled = true;
    settings.notifications.enabled = true;
    status.native = {
      loginStatus: "enabled",
      launchAtLogin: true,
      notificationPermission: "authorized",
      notificationAlertsAvailable: true,
    };
    mocks.rituals.mockResolvedValue({
      rituals: [{ kind: "morning", enabled: true, time: "08:00", timeZone: "America/New_York" }],
    });
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "desktop_settings") return status;
      if (command === "ritual_local") return { enabled: true };
      return { ok: true };
    });
    const { cache } = mount();
    expect(await screen.findByText("4 of 4 complete")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Review checks" }));
    await userEvent.click(screen.getByRole("button", { name: "Show 4 completed checks" }));
    expect(screen.getByText(/Scheduled for 08:00/)).toBeInTheDocument();
    mocks.rituals.mockRejectedValue(new Error("Offline"));
    mocks.invoke.mockRejectedValue(new Error("Offline"));
    await act(async () => {
      await cache.invalidateQueries();
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /completed checks/ })).not.toBeInTheDocument(),
    );
    expect(screen.getByText(/Could not check morning routine readiness/)).toBeInTheDocument();
  });

  it("explains disabled OS alerts even when notification permission is authorized", async () => {
    settings.notifications.enabled = true;
    status.native.notificationPermission = "authorized";
    status.native.notificationAlertsAvailable = false;
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Review checks" }));
    expect(
      screen.getByText(/Notifications are allowed, but macOS alerts are off/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set up notifications" })).toHaveAttribute(
      "href",
      "/settings?section=notifications",
    );
  });

  it("keeps explicit server switching disabled while startup registration is pending", async () => {
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Review checks" }));
    const write = deferred<DesktopStatus>();
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "desktop_settings") return status;
      if (command === "desktop_save_settings") return write.promise;
      return { enabled: false };
    });
    await userEvent.click(screen.getByRole("button", { name: "Enable launch at login" }));
    expect(screen.getByRole("button", { name: "Enable launch at login" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Connect to server" })).toBeDisabled();
    await act(async () =>
      write.resolve({ ...status, settings: { ...settings, launchAtLogin: true } }),
    );
  });

  it("guides pending macOS approval without claiming startup is enabled", async () => {
    status.native.loginStatus = "requiresApproval";
    settings.launchAtLogin = true;
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Review checks" }));
    expect(screen.getByText(/Approve nohmi in System Settings/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open Login Items" }));
    expect(mocks.invoke).toHaveBeenCalledWith("desktop_native_action", {
      action: "open_login_settings",
    });
    expect(mocks.invoke).not.toHaveBeenCalledWith("desktop_save_settings", expect.anything());
  });

  it("enables startup without discarding automatically saved pet preferences", async () => {
    mount({ section: "pet" });
    fireEvent.change(await screen.findByLabelText("Pet color"), { target: { value: "#123456" } });
    await waitFor(() => expect(status.settings.petColor).toBe("#123456"));
    await userEvent.click(screen.getByRole("button", { name: "Review checks" }));
    await userEvent.click(screen.getByRole("button", { name: "Enable launch at login" }));
    await waitFor(() =>
      expect(status.settings).toMatchObject({ petColor: "#123456", launchAtLogin: true }),
    );
    await userEvent.keyboard("{Escape}");
    expect(screen.getByLabelText("Pet color")).toHaveValue("#123456");
  });

  it("refreshes OS status on return without resetting an edited preference", async () => {
    mount({ section: "pet" });
    fireEvent.change(await screen.findByLabelText("Pet color"), { target: { value: "#123456" } });
    status = {
      ...status,
      native: { ...status.native, loginStatus: "enabled", launchAtLogin: true },
    };
    fireEvent.focus(window);
    await waitFor(() => expect(screen.getByText("1 of 4 complete")).toBeInTheDocument());
    expect(screen.getByLabelText("Pet color")).toHaveValue("#123456");
  });

  it("does not report a morning routine ready when automatic delivery is paused", async () => {
    mocks.rituals.mockResolvedValue({
      rituals: [{ kind: "morning", enabled: true, time: "08:00", timeZone: "America/New_York" }],
    });
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Review checks" }));
    expect(await screen.findByText(/Enable automatic rituals on this Mac/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Routine settings" })).toHaveAttribute(
      "href",
      "/settings?section=rituals",
    );
  });

  it("does not show a completion percentage when routine checks fail", async () => {
    mocks.rituals.mockRejectedValue(new Error("Offline"));
    mount();
    expect(await screen.findByText("Unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Review checks" }));
    expect(screen.getByText(/Could not check morning routine readiness/)).toBeInTheDocument();
  });

  it("shows registration failures without changing the saved startup preference", async () => {
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Review checks" }));
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "desktop_settings") return status;
      if (command === "desktop_save_settings") throw new Error("Cannot register");
      return { enabled: false };
    });
    await userEvent.click(screen.getByRole("button", { name: "Enable launch at login" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringMatching(/Couldn’t enable launch at login/),
        expect.anything(),
      ),
    );
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("switch", { name: "Open at login" })).not.toBeChecked();
  });

  it("does not poll macOS setup on an unsupported desktop", async () => {
    delete status.native.loginStatus;
    mount();
    await screen.findByRole("button", { name: "Connect to server" });
    expect(screen.queryByText("Keep nohmi active")).not.toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalledWith("ritual_local", expect.anything());
  });

  it("reports registration errors returned in a successful bridge response", async () => {
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Review checks" }));
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "desktop_save_settings")
        return {
          ...status,
          settings: { ...settings, launchAtLogin: true },
          native: { ...status.native, error: "Cannot register" },
        };
      if (command === "desktop_settings") return status;
      return { enabled: false };
    });
    await userEvent.click(screen.getByRole("button", { name: "Enable launch at login" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringMatching(/Couldn’t enable launch at login/),
        expect.anything(),
      ),
    );
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("switch", { name: "Open at login" })).toBeChecked();
  });

  it("allows setup navigation after preferences are automatically saved", async () => {
    mount({ section: "pet" });
    fireEvent.change(await screen.findByLabelText("Pet color"), { target: { value: "#123456" } });
    await waitFor(() => expect(status.settings.petColor).toBe("#123456"));
    await userEvent.click(screen.getByRole("button", { name: "Review checks" }));
    expect(screen.getByRole("link", { name: "Routine settings" })).toHaveAttribute(
      "href",
      "/settings?section=rituals",
    );
  });

  it("does not confuse notification errors with successful startup registration", async () => {
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Review checks" }));
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "desktop_save_settings")
        return {
          ...status,
          settings: { ...settings, launchAtLogin: true },
          native: {
            ...status.native,
            loginStatus: "enabled",
            launchAtLogin: true,
            error: "Notification delivery failed",
          },
        };
      if (command === "desktop_settings") return status;
      return { enabled: false };
    });
    await userEvent.click(screen.getByRole("button", { name: "Enable launch at login" }));
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: "Open at login" })).toBeChecked(),
    );
    expect(toast.error).toHaveBeenCalledWith("Notification delivery failed", expect.anything());
  });
});

it("uses one Sonner toast for Accessibility setup without inline action results", async () => {
  status.native.accessibilityPermission = false;
  mount({ section: "pet" });
  await userEvent.click(await screen.findByRole("button", { name: "Open Accessibility settings" }));
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith("Accessibility settings opened", expect.anything()),
  );
  expect(mocks.invoke).toHaveBeenCalledWith("desktop_native_action", {
    action: "request_accessibility_permission",
  });
  expect(vi.mocked(toast.success).mock.calls.at(-1)?.[1]?.id).toBe(
    vi.mocked(toast.loading).mock.calls.at(-1)?.[1]?.id,
  );
  expect(screen.queryByText("Accessibility settings opened")).not.toBeInTheDocument();
  expect(screen.getByText(/Accessibility not enabled/)).toBeInTheDocument();
});
it("reports Accessibility setup failure through Sonner only", async () => {
  status.native.accessibilityPermission = false;
  const previous = mocks.invoke.getMockImplementation();
  mocks.invoke.mockImplementation((command, args) =>
    command === "desktop_native_action"
      ? Promise.reject(new Error("Could not open Accessibility settings."))
      : previous?.(command, args),
  );
  mount({ section: "pet" });
  await userEvent.click(await screen.findByRole("button", { name: "Open Accessibility settings" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  expect(toast.success).not.toHaveBeenCalled();
  expect(screen.queryByText("Could not open Accessibility settings.")).not.toBeInTheDocument();
});

it("autosaves sleep settings and disables the delay when sleep is off", async () => {
  mount({ section: "pet" });
  const sleep = await screen.findByRole("switch", { name: "Sleep when idle" });
  await userEvent.click(sleep);
  await waitFor(() => expect(status.settings.petSleepEnabled).toBe(false));
  expect(screen.getByRole("slider", { name: "Sleep after" })).toHaveAttribute("data-disabled");
  await userEvent.click(sleep);
  await waitFor(() => expect(status.settings.petSleepEnabled).toBe(true));
  fireEvent.keyDown(screen.getByRole("slider", { name: "Sleep after" }), { key: "ArrowRight" });
  await waitFor(() => expect(status.settings.petSleepAfterSeconds).toBe(4));
});
