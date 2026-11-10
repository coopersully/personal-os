// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FinancePushProvider, FinancePushSettings } from "./finance-push-provider.ios";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
const h = vi.hoisted(() => ({
  owner: "owner",
  epoch: 1,
  enabled: false,
  register: vi.fn(async () => ({ audience: "audience" })),
  disable: vi.fn(async () => ({ disabled: true })),
  target: vi.fn(async () => ({ audience: "audience", destination: "finance_chat" })),
  token: vi.fn(async () => ({ type: "ios", data: "apple-token" })),
  permission: vi.fn(async () => ({ granted: true, canAskAgain: true })),
  request: vi.fn(),
  dismiss: vi.fn(),
  clearLast: vi.fn(),
  lastResponse: vi.fn(async (): Promise<unknown> => null),
  push: vi.fn(),
  loading: vi.fn(() => "finance-toast"),
  success: vi.fn(),
  error: vi.fn(),
  toastDismiss: vi.fn(),
  removes: [] as ReturnType<typeof vi.fn>[],
  app: undefined as undefined | ((value: string) => void),
  response: undefined as undefined | ((value: unknown) => void),
  rotate: undefined as undefined | ((value: unknown) => void),
}));
vi.mock("react-native", async () => ({
  ...(await import("../../../test/native")),
  AppState: {
    addEventListener: (_name: string, listener: (value: string) => void) => {
      h.app = listener;
      const remove = vi.fn();
      h.removes.push(remove);
      return { remove };
    },
  },
}));
vi.mock("expo-constants", () => ({
  default: { expoConfig: { extra: { apnsEnvironment: "production" } } },
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "installation" }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) =>
    key.includes("installation") ? "installation" : h.enabled ? "enabled" : "disabled",
  setItemAsync: vi.fn(async () => {}),
}));
vi.mock("expo-router", () => ({ router: { push: h.push } }));
vi.mock("sonner-native", () => ({
  toast: { loading: h.loading, success: h.success, error: h.error, dismiss: h.toastDismiss },
}));
const session = {
  epoch: () => h.epoch,
  api: () => ({
    registerNativePushDevice: h.register,
    disableNativePushDevice: h.disable,
    getNativePushEvent: h.target,
  }),
};
vi.mock("../auth/context", () => ({
  mobileApiOrigin: "https://test.nohmi.example",
  useAuth: () => ({
    state: h.owner
      ? { status: "signedIn", user: { id: h.owner } }
      : { status: "signedOut", user: null },
    session,
  }),
  useOptionalAuth: () => null,
}));
vi.mock("../../components/icons", () => ({ Icon: () => null }));
vi.mock("expo-notifications", () => ({
  IosAuthorizationStatus: { PROVISIONAL: 3 },
  getPermissionsAsync: h.permission,
  requestPermissionsAsync: h.request,
  getDevicePushTokenAsync: h.token,
  getPresentedNotificationsAsync: async () => [
    {
      request: {
        identifier: "finance",
        content: { data: { version: 1, kind: "finance", audience: "audience", eventId: "event" } },
      },
    },
    { request: { identifier: "task", content: { data: { owner: "owner" } } } },
  ],
  dismissNotificationAsync: h.dismiss,
  clearLastNotificationResponseAsync: h.clearLast,
  getLastNotificationResponseAsync: h.lastResponse,
  addNotificationResponseReceivedListener: (listener: (value: unknown) => void) => {
    h.response = listener;
    const remove = vi.fn();
    h.removes.push(remove);
    return { remove };
  },
  addPushTokenListener: (listener: (value: unknown) => void) => {
    h.rotate = listener;
    const remove = vi.fn();
    h.removes.push(remove);
    return { remove };
  },
}));
function Settings() {
  return (
    <FinancePushProvider>
      <FinancePushSettings />
    </FinancePushProvider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  h.owner = "owner";
  h.epoch = 1;
  h.enabled = false;
  h.removes = [];
  h.lastResponse.mockResolvedValue(null);
  h.register.mockResolvedValue({ audience: "audience" });
  h.permission.mockResolvedValue({ granted: true, canAskAgain: true });
});
afterEach(cleanup);
it("shows an explicit Finance toggle and sends action outcomes only through Sonner", async () => {
  render(<Settings />);
  const toggle = await screen.findByRole("switch", { name: "Finance notifications" });
  await waitFor(() => expect(toggle).not.toBeDisabled());
  fireEvent.click(toggle);
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith(
      "Finance notifications enabled. iOS controls delivery.",
      { id: "finance-toast" },
    ),
  );
  expect(h.loading).toHaveBeenCalled();
  expect(screen.queryByText("Finance notifications enabled. iOS controls delivery.")).toBeNull();
});
it("keeps auto-sync silent and uses the rotation event token without another APNs request", async () => {
  h.enabled = true;
  render(<Settings />);
  await waitFor(() => expect(h.register).toHaveBeenCalledTimes(1));
  await act(async () => h.rotate?.({ type: "ios", data: "rotated" }));
  await waitFor(() => expect(h.register).toHaveBeenCalledTimes(2));
  expect(h.token).toHaveBeenCalledTimes(1);
  expect(h.register).toHaveBeenLastCalledWith(expect.objectContaining({ token: "rotated" }));
  expect(h.loading).not.toHaveBeenCalled();
  expect(h.success).not.toHaveBeenCalled();
});
it("clears only presented Finance notifications and removes listeners on logout", async () => {
  const view = render(<Settings />);
  await waitFor(() => expect(h.removes).toHaveLength(3));
  const removes = [...h.removes];
  h.owner = "";
  h.epoch += 1;
  view.rerender(<Settings />);
  await waitFor(() => expect(removes.every((remove) => remove.mock.calls.length === 1)).toBe(true));
  expect(h.dismiss).toHaveBeenCalledWith("finance");
  expect(h.dismiss).not.toHaveBeenCalledWith("task");
});
it("reports permission denial through Sonner without inline action-result copy", async () => {
  h.permission.mockResolvedValue({ granted: false, canAskAgain: false });
  render(<Settings />);
  const toggle = await screen.findByRole("switch", { name: "Finance notifications" });
  await waitFor(() => expect(toggle).not.toBeDisabled());
  fireEvent.click(toggle);
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Allow notifications in iOS Settings to enable Finance notifications.",
      { id: "finance-toast" },
    ),
  );
  expect(
    screen.queryByText("Allow notifications in iOS Settings to enable Finance notifications."),
  ).toBeNull();
  expect(h.register).not.toHaveBeenCalled();
});
it("routes cold notification responses only after authenticated lookup", async () => {
  h.enabled = true;
  render(<Settings />);
  await waitFor(() => expect(h.register).toHaveBeenCalled());
  await act(async () =>
    h.response?.({
      notification: {
        request: {
          content: {
            data: { version: 1, kind: "finance", eventId: "event", audience: "audience" },
          },
        },
      },
    }),
  );
  await waitFor(() =>
    expect(h.push).toHaveBeenCalledWith({
      pathname: "/(workspaces)/finances/assistant",
      params: { view: "Conversation" },
    }),
  );
  expect(h.target).toHaveBeenCalledWith("event", "installation");
});

it("replays a cold tap after offline registration recovers", async () => {
  h.enabled = true;
  const response = {
    notification: {
      request: {
        content: {
          data: { version: 1, kind: "finance", eventId: "event", audience: "audience" },
        },
      },
    },
  };
  h.lastResponse.mockResolvedValue(response);
  h.register.mockRejectedValueOnce(new Error("offline"));
  render(<Settings />);
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  await act(async () => h.response?.(response));
  expect(h.clearLast).not.toHaveBeenCalled();
  expect(h.push).not.toHaveBeenCalled();
  await act(async () => h.app?.("active"));
  await waitFor(() => expect(h.push).toHaveBeenCalledTimes(1));
  expect(h.clearLast).toHaveBeenCalledTimes(1);
  await act(async () => h.app?.("active"));
  await waitFor(() => expect(h.register).toHaveBeenCalledTimes(3));
  expect(h.push).toHaveBeenCalledTimes(1);
});
it("opens the authenticated per-event detail for an attention notification", async () => {
  h.enabled = true;
  h.target.mockResolvedValue({ audience: "audience", destination: "finance_attention" });
  render(<Settings />);
  await waitFor(() => expect(h.register).toHaveBeenCalled());
  await act(async () =>
    h.response?.({
      notification: {
        request: {
          content: {
            data: { version: 1, kind: "finance", eventId: "event", audience: "audience" },
          },
        },
      },
    }),
  );
  await waitFor(() =>
    expect(h.push).toHaveBeenCalledWith({
      pathname: "/finance-notification",
      params: { eventId: "event", installationId: "installation" },
    }),
  );
});
