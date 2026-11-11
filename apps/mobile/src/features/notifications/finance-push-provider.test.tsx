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
  extra: { apnsEnvironment: "production" as string | undefined },
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
  default: { expoConfig: { extra: h.extra } },
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
  h.extra.apnsEnvironment = "production";
  h.disable.mockResolvedValue({ disabled: true });
  h.target.mockResolvedValue({ audience: "audience", destination: "finance_chat" });
  h.token.mockResolvedValue({ type: "ios", data: "apple-token" });
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

it("requests permission on opt-in and allows revoking a successful subscription", async () => {
  h.permission.mockResolvedValue({ granted: false, canAskAgain: true });
  h.request.mockResolvedValue({ granted: false, ios: { status: 3 } });
  render(<Settings />);
  const toggle = screen.getByRole("switch", { name: "Finance notifications" });
  await waitFor(() => expect(h.lastResponse).toHaveBeenCalled());
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).toBeChecked());
  expect(h.request).toHaveBeenCalledOnce();
  expect(h.register).toHaveBeenCalledOnce();
  await waitFor(() => expect(toggle).not.toBeDisabled());
  fireEvent.click(toggle);
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Finance notifications disabled.", {
      id: "finance-toast",
    }),
  );
  expect(h.loading).toHaveBeenLastCalledWith("Disabling Finance notifications…");
  expect(toggle).not.toBeChecked();
});

it("keeps unsupported builds from attempting registration", async () => {
  h.extra.apnsEnvironment = undefined;
  render(<Settings />);
  expect(screen.getByRole("switch", { name: "Finance notifications" })).toBeDisabled();
  expect(h.register).not.toHaveBeenCalled();
  expect(h.removes).toHaveLength(0);
});

it("offers a retry when the native token API returns an unsupported token", async () => {
  h.token.mockResolvedValueOnce({ type: "android", data: "invalid-token" });
  render(<Settings />);
  const toggle = screen.getByRole("switch", { name: "Finance notifications" });
  await waitFor(() => expect(h.lastResponse).toHaveBeenCalled());
  fireEvent.click(toggle);
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith("Native iPhone push registration is unavailable.", {
      id: "finance-toast",
    }),
  );
  expect(h.register).not.toHaveBeenCalled();
  expect(toggle).not.toBeChecked();
  await waitFor(() => expect(toggle).not.toBeDisabled());
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).toBeChecked());
});

it("drops a pending permission result when logout replaces the session", async () => {
  const permission = Promise.withResolvers<{ granted: boolean; canAskAgain: boolean }>();
  h.permission.mockReturnValueOnce(permission.promise);
  const view = render(<Settings />);
  await waitFor(() => expect(h.lastResponse).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("switch", { name: "Finance notifications" }));
  await waitFor(() => expect(h.permission).toHaveBeenCalledOnce());
  h.owner = "";
  h.epoch += 1;
  view.rerender(<Settings />);
  await act(async () => permission.resolve({ granted: false, canAskAgain: true }));
  await waitFor(() => expect(h.toastDismiss).toHaveBeenCalledWith("finance-toast"));
  expect(h.request).not.toHaveBeenCalled();
  expect(h.register).not.toHaveBeenCalled();
  expect(h.error).not.toHaveBeenCalled();
});

it("ignores unrelated taps, retains a failed lookup and opens Activity on retry", async () => {
  h.enabled = true;
  const response = (data: unknown) => ({ notification: { request: { content: { data } } } });
  const event = response({ version: 1, kind: "finance", eventId: "event", audience: "audience" });
  h.target.mockRejectedValueOnce(new Error("offline"));
  h.target.mockResolvedValue({ audience: "audience", destination: "finance_activity" });
  render(<Settings />);
  await waitFor(() => expect(h.lastResponse).toHaveBeenCalled());
  await act(async () => h.response?.(response({ owner: "owner" })));
  expect(h.target).not.toHaveBeenCalled();
  await act(async () => h.response?.(event));
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith("Couldn’t open Finance. Open nohmi to review it."),
  );
  expect(h.clearLast).not.toHaveBeenCalled();
  await act(async () => h.response?.(event));
  await waitFor(() =>
    expect(h.push).toHaveBeenCalledWith({
      pathname: "/(workspaces)/finances/assistant",
      params: { view: "Activity" },
    }),
  );
});

it("deduplicates foreground sync failures until a successful sync", async () => {
  h.enabled = true;
  h.register.mockRejectedValue(new Error("offline"));
  render(<Settings />);
  await waitFor(() => expect(h.error).toHaveBeenCalledOnce());
  await act(async () => h.app?.("active"));
  expect(h.register).toHaveBeenCalledTimes(2);
  expect(h.error).toHaveBeenCalledOnce();

  h.register.mockResolvedValueOnce({ audience: "audience" });
  await act(async () => h.app?.("active"));
  expect(h.lastResponse).toHaveBeenCalledOnce();
  expect(h.success).not.toHaveBeenCalled();

  await act(async () => h.app?.("active"));
  expect(h.error).toHaveBeenCalledTimes(2);
});

it("does not show a sync error after logout while registration was pending", async () => {
  h.enabled = true;
  const registration = Promise.withResolvers<{ audience: string }>();
  h.register.mockReturnValueOnce(registration.promise);
  const view = render(<Settings />);
  await waitFor(() => expect(h.register).toHaveBeenCalledOnce());
  h.owner = "";
  h.epoch += 1;
  view.rerender(<Settings />);
  await act(async () => registration.reject(new Error("offline")));
  expect(h.error).not.toHaveBeenCalled();
  expect(h.lastResponse).not.toHaveBeenCalled();
});
