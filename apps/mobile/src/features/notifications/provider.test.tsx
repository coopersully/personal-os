// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { refreshDueAlerts } from "./events";
import { NotificationProvider, NotificationSettings } from "./provider.ios";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
const h = vi.hoisted(() => ({
  state: { status: "signedIn", user: { id: "owner" } },
  permission: { granted: true, canAskAgain: true, ios: { status: 2 } },
  list: vi.fn(),
  getItem: vi.fn(),
  setItem: vi.fn(),
  scheduled: vi.fn(),
  presented: vi.fn(),
  cancel: vi.fn(),
  dismiss: vi.fn(),
  schedule: vi.fn(),
  request: vi.fn(),
  last: vi.fn(),
  clearLast: vi.fn(),
  push: vi.fn(),
  openSettings: vi.fn(),
  removeApp: vi.fn(),
  removeResponse: vi.fn(),
  loading: vi.fn(() => "notification-toast"),
  success: vi.fn(),
  error: vi.fn(),
  app: undefined as undefined | ((value: string) => void),
  response: undefined as undefined | ((value: unknown) => void),
  handler: undefined as undefined | { handleNotification: () => Promise<unknown> },
}));
vi.mock("react-native", async () => ({
  ...(await import("../../../test/native")),
  AppState: {
    currentState: "active",
    addEventListener: (_name: string, listener: (value: string) => void) => {
      h.app = listener;
      return { remove: h.removeApp };
    },
  },
  Linking: { openSettings: h.openSettings },
}));
vi.mock("../../components/icons", () => ({ Icon: () => null }));
vi.mock("../auth/context", () => ({
  useAuth: () => ({ state: h.state, session: { api: () => ({ listTaskWorkspace: h.list }) } }),
}));
vi.mock("expo-router", () => ({ router: { push: h.push } }));
vi.mock("expo-secure-store", () => ({ getItemAsync: h.getItem, setItemAsync: h.setItem }));
vi.mock("sonner-native", () => ({ toast: h }));
vi.mock("expo-notifications", () => ({
  setNotificationHandler: (handler: typeof h.handler) => {
    h.handler = handler;
  },
  IosAuthorizationStatus: { PROVISIONAL: 3 },
  SchedulableTriggerInputTypes: { DATE: "date" },
  getPermissionsAsync: async () => h.permission,
  requestPermissionsAsync: h.request,
  getAllScheduledNotificationsAsync: h.scheduled,
  getPresentedNotificationsAsync: h.presented,
  cancelScheduledNotificationAsync: h.cancel,
  dismissNotificationAsync: h.dismiss,
  scheduleNotificationAsync: h.schedule,
  getLastNotificationResponseAsync: h.last,
  clearLastNotificationResponseAsync: h.clearLast,
  addNotificationResponseReceivedListener: (listener: (value: unknown) => void) => {
    h.response = listener;
    return { remove: h.removeResponse };
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  h.state = { status: "signedIn", user: { id: "owner" } };
  h.permission = { granted: true, canAskAgain: true, ios: { status: 2 } };
  h.getItem.mockReset().mockResolvedValue(null);
  h.setItem.mockReset().mockResolvedValue(undefined);
  h.list.mockReset().mockResolvedValue({ items: [], nextCursor: null });
  h.scheduled.mockReset().mockResolvedValue([]);
  h.presented.mockReset().mockResolvedValue([]);
  h.cancel.mockReset().mockResolvedValue(undefined);
  h.dismiss.mockReset().mockResolvedValue(undefined);
  h.schedule.mockReset().mockResolvedValue("scheduled");
  h.last.mockReset().mockResolvedValue(null);
  h.clearLast.mockReset().mockResolvedValue(undefined);
  h.openSettings.mockReset().mockResolvedValue(undefined);
  h.request.mockReset().mockImplementation(async () => {
    h.permission = { granted: true, canAskAgain: true, ios: { status: 2 } };
    return h.permission;
  });
});
afterEach(async () => {
  cleanup();
  await act(async () => {});
  vi.useRealTimers();
});
const view = () => (
  <NotificationProvider>
    <NotificationSettings />
  </NotificationProvider>
);
const toggle = () => screen.getByRole("switch", { name: "Task & reminder due alerts" });
const settle = () => waitFor(() => expect(h.getItem).toHaveBeenCalled());
const request = (owner: string, suffix = "task.one") => ({
  identifier: `personal-os.due.${owner}.${suffix}`,
  content: { data: { owner, kind: "task", id: "one" } },
});
it("uses quiet foreground presentation and renders nothing without the provider", async () => {
  expect(await h.handler?.handleNotification()).toEqual({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: false,
    shouldShowList: true,
  });
  const { container } = render(<NotificationSettings />);
  expect(container).toBeEmptyDOMElement();
});
it("requests standard permission only on opt-in and schedules privacy-preserving task/reminder alerts", async () => {
  h.permission = { granted: false, canAskAgain: true, ios: { status: 0 } };
  const dueAt = new Date(Date.now() + 120000).toISOString();
  h.list.mockResolvedValue({
    items: ["task", "reminder"].map((kind) => ({
      kind,
      record: {
        id: kind,
        title: "Private subject",
        lifecycle: "open",
        completedAt: null,
        dueAt,
      },
    })),
    nextCursor: null,
  });
  render(view());
  await settle();
  expect(h.request).not.toHaveBeenCalled();
  fireEvent.click(toggle());
  await waitFor(() => expect(h.schedule).toHaveBeenCalledTimes(2));
  expect(h.request).toHaveBeenCalledWith({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  expect(h.setItem).toHaveBeenCalledWith("personal-os.due-alerts.v1.owner", "enabled");
  expect(h.schedule.mock.calls.map(([value]) => value.content.body)).toEqual([
    "A reminder is due. Open nohmi to review it.",
    "A task is due. Open nohmi to review it.",
  ]);
  expect(JSON.stringify(h.schedule.mock.calls)).not.toContain("Private subject");
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith(
      "Device alert scheduling enabled. iOS controls delivery.",
      { id: "notification-toast" },
    ),
  );
  expect(
    screen.queryByText("Device alert scheduling enabled. iOS controls delivery."),
  ).not.toBeInTheDocument();
});
it("keeps permission denial recoverable without saving an enabled preference", async () => {
  h.permission = { granted: false, canAskAgain: false, ios: { status: 0 } };
  render(view());
  await settle();
  fireEvent.click(toggle());
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Notifications are disabled. Allow them in iOS Settings.",
      { id: "notification-toast" },
    ),
  );
  expect(h.request).not.toHaveBeenCalled();
  expect(h.setItem).not.toHaveBeenCalled();
  expect(toggle()).not.toBeChecked();
  expect(screen.getByText(/Not allowed by iOS/)).toBeVisible();
  h.openSettings.mockRejectedValue(new Error("unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "Open iOS notification settings" }));
  await waitFor(() => expect(h.error).toHaveBeenCalledWith("Couldn’t open iOS Settings."));
});
it("clears previous-account alerts while preserving unrelated notifications, then disables owned alerts", async () => {
  const own = request("owner"),
    other = request("previous"),
    unrelated = { identifier: "other-feature", content: { data: {} } };
  h.scheduled.mockResolvedValue([own, other, unrelated]);
  h.presented.mockResolvedValue([own, other, unrelated].map((entry) => ({ request: entry })));
  render(view());
  await settle();
  expect(h.cancel).toHaveBeenCalledExactlyOnceWith(other.identifier);
  expect(h.dismiss).toHaveBeenCalledExactlyOnceWith(other.identifier);
  expect(h.cancel).not.toHaveBeenCalledWith(unrelated.identifier);
  fireEvent.click(toggle());
  await waitFor(() => expect(toggle()).toBeChecked());
  await waitFor(() => expect(h.success).toHaveBeenCalled());
  h.cancel.mockClear();
  h.dismiss.mockClear();
  fireEvent.click(toggle());
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Device alerts disabled.", { id: "notification-toast" }),
  );
  expect(h.cancel).toHaveBeenCalledWith(own.identifier);
  expect(h.dismiss).toHaveBeenCalledWith(own.identifier);
  expect(h.setItem).toHaveBeenLastCalledWith("personal-os.due-alerts.v1.owner", "disabled");
  expect(screen.queryByRole("button", { name: "Send test notification" })).not.toBeInTheDocument();
});
it("restores provisional permission and refreshes on foreground and completed mutations", async () => {
  h.getItem.mockResolvedValue("enabled");
  h.permission = { granted: false, canAskAgain: false, ios: { status: 3 } };
  const { unmount } = render(view());
  await waitFor(() => expect(h.list).toHaveBeenCalledOnce());
  await act(async () => {
    h.app?.("background");
    h.app?.("active");
    refreshDueAlerts();
  });
  await waitFor(() => expect(h.list).toHaveBeenCalledTimes(3));
  expect(h.request).not.toHaveBeenCalled();
  unmount();
  expect(h.removeApp).toHaveBeenCalledOnce();
  expect(h.removeResponse).toHaveBeenCalledOnce();
  refreshDueAlerts();
  expect(h.list).toHaveBeenCalledTimes(3);
});
it("does not schedule a late response after the owner signs out", async () => {
  h.getItem.mockResolvedValue("enabled");
  let finish!: (value: unknown) => void;
  h.list.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { rerender } = render(view());
  await waitFor(() => expect(h.list).toHaveBeenCalled());
  h.state = { status: "signedOut", user: { id: "unused" } };
  rerender(view());
  await act(async () =>
    finish({
      items: [
        {
          kind: "task",
          record: {
            id: "one",
            lifecycle: "open",
            dueAt: new Date(Date.now() + 100000).toISOString(),
          },
        },
      ],
      nextCursor: null,
    }),
  );
  expect(h.schedule).not.toHaveBeenCalled();
  expect(toggle()).not.toBeChecked();
});
it("does not discard alerts while session verification is temporarily unavailable", async () => {
  h.state.status = "unavailable";
  render(view());
  await act(async () => {});
  expect(h.scheduled).not.toHaveBeenCalled();
  expect(h.getItem).not.toHaveBeenCalled();
});
it("clears owned schedules when iOS revokes permission and reports refresh failures", async () => {
  h.getItem.mockResolvedValue("enabled");
  h.permission = { granted: false, canAskAgain: false, ios: { status: 0 } };
  h.scheduled.mockResolvedValue([request("owner")]);
  render(view());
  await waitFor(() => expect(h.cancel).toHaveBeenCalledWith(request("owner").identifier));
  expect(h.list).not.toHaveBeenCalled();
  h.permission.granted = true;
  h.list.mockRejectedValue(new Error("offline"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh device schedule" }));
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith("Couldn’t refresh device alerts.", {
      id: "notification-toast",
    }),
  );
  await act(async () => refreshDueAlerts());
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Couldn’t refresh device alerts. Open Task preferences to retry.",
      { id: "due-alert-sync" },
    ),
  );
});
it("confirms test scheduling without claiming a banner was delivered", async () => {
  h.getItem.mockResolvedValue("enabled");
  render(view());
  await waitFor(() => expect(toggle()).toBeChecked());
  fireEvent.click(screen.getByRole("button", { name: "Send test notification" }));
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith(
      "Test scheduled for 5 seconds. Background nohmi to check the banner.",
      { id: "notification-toast" },
    ),
  );
  expect(h.schedule).toHaveBeenCalledWith(
    expect.objectContaining({
      identifier: "personal-os.due.owner.test",
      content: expect.objectContaining({ data: { owner: "owner" } }),
    }),
  );
  h.schedule.mockRejectedValue(new Error("OS unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "Send test notification" }));
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith("Couldn’t schedule a test notification.", {
      id: "notification-toast",
    }),
  );
});
it("opens an owned notification once and rejects cross-account or foreign responses", async () => {
  const response = { notification: { request: request("owner"), date: 123 } };
  h.last.mockResolvedValue(response);
  render(view());
  await waitFor(() => expect(h.push).toHaveBeenCalledOnce());
  await act(async () => {
    h.response?.(response);
    h.response?.({ notification: { request: request("other"), date: 124 } });
    h.response?.({
      notification: { request: { ...request("owner"), identifier: "other-feature" }, date: 125 },
    });
  });
  expect(h.push).toHaveBeenCalledExactlyOnceWith({
    pathname: "/task-editor",
    params: { id: "one", kind: "task" },
  });
  expect(h.clearLast).toHaveBeenCalledTimes(3);
});
it("rejects test scheduling after permission is revoked without reporting delivery", async () => {
  h.getItem.mockResolvedValue("enabled");
  render(view());
  await waitFor(() => expect(toggle()).toBeChecked());
  h.permission = { granted: false, canAskAgain: false, ios: { status: 0 } };
  fireEvent.click(screen.getByRole("button", { name: "Send test notification" }));
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith("Couldn’t schedule a test notification.", {
      id: "notification-toast",
    }),
  );
  expect(h.schedule).not.toHaveBeenCalled();
  expect(h.success).not.toHaveBeenCalled();
});
it("does not enable a different owner's alerts after a delayed permission response", async () => {
  h.permission = { granted: false, canAskAgain: true, ios: { status: 0 } };
  let finish!: (value: typeof h.permission) => void;
  h.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { rerender } = render(view());
  await settle();
  fireEvent.click(toggle());
  await waitFor(() => expect(h.request).toHaveBeenCalledOnce());
  h.state = { status: "signedIn", user: { id: "other" } };
  rerender(view());
  await act(async () => finish({ granted: true, canAskAgain: true, ios: { status: 2 } }));
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith("Your account changed. Please try again.", {
      id: "notification-toast",
    }),
  );
  expect(h.setItem).not.toHaveBeenCalled();
  expect(h.schedule).not.toHaveBeenCalled();
});
it("reports persistence failures without claiming alerts were enabled", async () => {
  h.setItem.mockRejectedValueOnce("failed");
  render(view());
  await settle();
  fireEvent.click(toggle());
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith("Couldn’t update device alerts.", {
      id: "notification-toast",
    }),
  );
  expect(h.success).not.toHaveBeenCalled();
  expect(toggle()).not.toBeChecked();
});
it("does not publish the previous owner's preference when Keychain finishes after an account switch", async () => {
  let finish!: () => void;
  h.setItem.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const { rerender } = render(view());
  await settle();
  fireEvent.click(toggle());
  await waitFor(() =>
    expect(h.setItem).toHaveBeenCalledWith("personal-os.due-alerts.v1.owner", "enabled"),
  );
  h.state = { status: "signedIn", user: { id: "other" } };
  rerender(view());
  await act(async () => finish());
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith("Your account changed. Please try again.", {
      id: "notification-toast",
    }),
  );
  expect(h.success).not.toHaveBeenCalled();
  expect(toggle()).not.toBeChecked();
  expect(h.schedule).not.toHaveBeenCalled();
});
