// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
vi.mock("sonner", () => ({ toast: { dismiss: vi.fn(), error: vi.fn(), success: mocks.success } }));
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
      <DesktopSettingsPanel {...props} />
    </QueryClientProvider>,
  );
  if (props.connectionOnly)
    fireEvent.click(screen.getByRole("button", { name: "Server settings" }));
  return { ...rendered, cache };
}
async function save() {
  await userEvent.click(screen.getByRole("button", { name: "Save preferences" }));
  await waitFor(() =>
    expect(mocks.invoke).toHaveBeenCalledWith("desktop_save_settings", expect.anything()),
  );
  return mocks.invoke.mock.calls.find(([command]) => command === "desktop_save_settings")?.[1]
    .settings as DesktopSettings;
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
      loginStatus: "notRegistered",
      widgetsAvailable: false,
    },
  };
  mocks.invoke.mockImplementation(
    async (command: string, args?: { settings?: DesktopSettings }) => {
      if (command === "ritual_local") return { enabled: false };
      if (command === "desktop_settings") return status;
      if (command === "desktop_save_settings") return { ...status, settings: args?.settings };
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
    expect(screen.getByRole("button", { name: "Save preferences" })).toBeEnabled();
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
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith("Desktop preferences saved"));
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

  it("keeps draft notification choices when requesting permission refreshes native status", async () => {
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

  it("saves selected mail accounts, calendars, timing, privacy and quiet hours", async () => {
    mount({ section: "notifications" });
    await screen.findByRole("checkbox", { name: "cooper@example.com" });
    expect(screen.getAllByRole("checkbox", { name: "cooper@example.com" })).toHaveLength(1);
    expect(screen.getByRole("checkbox", { name: "Mail account 2" })).toBeInTheDocument();
    for (const label of [
      "Enable notifications",
      "Tasks due",
      "Reminders due",
      "Upcoming events",
      "New mail",
      "Play notification sounds",
      "Show message previews",
    ]) {
      await userEvent.click(screen.getByRole("switch", { name: label }));
    }
    for (const label of ["Personal", "cooper@example.com"]) {
      await userEvent.click(screen.getByRole("checkbox", { name: label }));
      await userEvent.click(screen.getByRole("checkbox", { name: label }));
      await userEvent.click(screen.getByRole("checkbox", { name: label }));
    }
    fireEvent.change(screen.getByLabelText("Minutes before an event"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "22:00" } });
    fireEvent.change(screen.getByLabelText("Until"), { target: { value: "07:00" } });
    const saved = await save();
    expect(saved.notifications).toEqual({
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
    expect(saved.petWorkspaces).toEqual(settings.petWorkspaces);
    expect(saved.widgetWorkspaces).toEqual(settings.widgetWorkspaces);
  });

  it("shows rejected saves without losing the draft or claiming success", async () => {
    mount({ section: "pet" });
    await screen.findByLabelText("Pet color");
    fireEvent.change(screen.getByLabelText("Pet color"), { target: { value: "#123456" } });
    mocks.invoke.mockRejectedValueOnce("Desktop settings could not be written");
    await userEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    expect(await screen.findByText(/Couldn’t save desktop preferences/)).toBeInTheDocument();
    expect(screen.getByLabelText("Pet color")).toHaveValue("#123456");
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.assign).not.toHaveBeenCalled();
    await save();
    await waitFor(() => expect(mocks.success).toHaveBeenCalled());
  });

  it("offers retry when loading desktop settings fails", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("Keychain unavailable"));
    mount();
    expect(await screen.findByText(/Couldn’t load desktop preferences/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
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

  it("prevents duplicate saves while the native write is pending", async () => {
    mount();
    await screen.findByText("Recommended");
    const write = deferred<DesktopStatus>();
    mocks.invoke.mockReturnValueOnce(write.promise);
    await userEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    const saving = screen.getByRole("button", { name: "Saving…" });
    expect(saving).toBeDisabled();
    await userEvent.click(saving);
    expect(
      mocks.invoke.mock.calls.filter(([command]) => command === "desktop_save_settings"),
    ).toHaveLength(1);
    await act(async () => write.resolve(status));
    expect(await screen.findByRole("button", { name: "Save preferences" })).toBeEnabled();
  });

  it("keeps notification settings usable when mail and calendar accounts cannot load", async () => {
    status = { ...status, native: {} };
    mocks.mailboxes.mockRejectedValue(new Error("Offline"));
    mocks.calendars.mockRejectedValue(new Error("Offline"));
    mocks.accounts.mockRejectedValue(new Error("Offline"));
    mount({ section: "notifications" });
    expect(await screen.findByText("Couldn’t load mail accounts.")).toBeInTheDocument();
    expect(screen.getByText("macOS permission: unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save preferences" })).toBeEnabled();
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
    mount({ section: "notifications" });

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
    expect(screen.getByRole("button", { name: "Save preferences" })).toBeEnabled();
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

  it("blocks preference saves while the setup startup write is pending", async () => {
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
    expect(screen.getByRole("button", { name: "Save preferences" })).toBeDisabled();
    await act(async () =>
      write.resolve({ ...status, settings: { ...settings, launchAtLogin: true } }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save preferences" })).toBeEnabled(),
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

  it("enables startup without committing or discarding unsaved pet preferences", async () => {
    mount({ section: "pet" });
    fireEvent.change(await screen.findByLabelText("Pet color"), { target: { value: "#123456" } });
    await userEvent.click(screen.getByRole("button", { name: "Review checks" }));
    await userEvent.click(screen.getByRole("button", { name: "Enable launch at login" }));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("desktop_save_settings", {
        settings: { ...settings, launchAtLogin: true },
      }),
    );
    await userEvent.keyboard("{Escape}");
    expect(screen.getByLabelText("Pet color")).toHaveValue("#123456");
    await userEvent.click(screen.getByRole("button", { name: "Save preferences" }));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith("desktop_save_settings", {
        settings: { ...settings, launchAtLogin: true, petColor: "#123456" },
      }),
    );
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
    await screen.findByRole("button", { name: "Save preferences" });
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

  it("keeps dirty pet preferences safe from setup navigation", async () => {
    mount({ section: "pet" });
    fireEvent.change(await screen.findByLabelText("Pet color"), { target: { value: "#123456" } });
    await userEvent.click(screen.getByRole("button", { name: "Review checks" }));
    expect(screen.queryByRole("link", { name: "Pet settings" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Routine settings — save preferences first" }),
    ).toBeDisabled();
    expect(screen.queryByRole("link", { name: "Routine settings" })).not.toBeInTheDocument();
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
    expect(toast.error).not.toHaveBeenCalled();
  });
});
