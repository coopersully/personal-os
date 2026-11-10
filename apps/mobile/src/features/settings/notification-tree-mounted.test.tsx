// @vitest-environment jsdom
import { defaultNotificationPreferences } from "@personal-os/domain";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MobileDataProvider } from "../tasks/data";
import {
  FinanceNotificationPolicyScreen,
  GlobalNotificationPolicyScreen,
  NotificationsSettingsScreen,
} from "./notifications";
import { TextingSettingsScreen } from "./texting";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("@tanstack/react-query", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/apps/web/package.json`)("@tanstack/react-query");
});
const h = vi.hoisted(() => ({
  owner: "owner",
  epoch: 1,
  prevent: false,
  push: vi.fn(),
  back: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  open: vi.fn(),
  alertMessage: "",
  foreground: undefined as undefined | (() => void),
  dismissAction: undefined as
    | undefined
    | { label: string; disabled?: boolean; onPress: () => void },
  buttons: [] as { text: string; onPress?: () => void }[],
  api: {
    getNotificationStatus: vi.fn(),
    saveNotificationPreferences: vi.fn(),
    resetFinanceNotificationPreferences: vi.fn(),
    getTextingConnection: vi.fn(),
    startTextingVerification: vi.fn(),
    checkTextingVerification: vi.fn(),
    disconnectTexting: vi.fn(),
  },
}));
vi.mock("../auth/context", () => ({
  useOptionalAuth: () => null,
  useAuth: () => ({
    state: { user: { id: h.owner } },
    session: { epoch: () => h.epoch, api: () => h.api },
  }),
}));
vi.mock("expo-router", () => ({
  router: { push: h.push, back: h.back },
  Stack: { Screen: () => null },
  usePreventRemove: (prevent: boolean) => {
    h.prevent = prevent;
    return () => {};
  },
}));
vi.mock("react-native", async () => ({
  ...(await import("../../../test/native")),
  Platform: { OS: "ios" },
  AppState: {
    addEventListener: (_name: string, listener: (value: string) => void) => {
      h.foreground = () => listener("active");
      return { remove: vi.fn() };
    },
  },
  Linking: { openURL: h.open },
  Alert: {
    alert: (_title: string, _message: string, buttons: typeof h.buttons) => {
      h.buttons = buttons;
      h.alertMessage = _message;
    },
  },
}));
vi.mock("../../components/icons", () => ({ Icon: () => null }));
vi.mock("../../components/editor-header", () => ({
  editorDismissOptions: (action: NonNullable<typeof h.dismissAction>) => {
    h.dismissAction = action;
    return {};
  },
}));
vi.mock("../notifications/provider", () => ({
  NotificationSettings: () => <div>iPhone device notifications</div>,
}));
vi.mock("../../components/forms/form-save", () => ({
  FormSave: ({
    label,
    disabled,
    onPress,
  }: {
    label: string;
    disabled: boolean;
    onPress: () => void;
  }) => (
    <button type="button" data-testid="floating-save" disabled={disabled} onClick={onPress}>
      {label}
    </button>
  ),
}));
vi.mock("sonner-native", () => ({
  toast: { error: h.error, success: h.success, loading: () => "toast", dismiss: vi.fn() },
}));
vi.mock("../tasks/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tasks/ui")>();
  return {
    ...actual,
    FormBody: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="form-scroll">{children}</div>
    ),
  };
});
const wrap = (node: React.ReactNode) => (
  <MobileDataProvider key={`${h.owner}:${h.epoch}`}>{node}</MobileDataProvider>
);
const notificationStatus = (revision = 2) => ({
  timeZone: "America/New_York",
  capability: "available",
  reason: null,
  preferences: [{ scope: "global", revision, preferences: { ...defaultNotificationPreferences } }],
  effective: defaultNotificationPreferences,
  intents: [],
  attempts: [],
});
const disconnected = {
  id: null,
  state: null,
  providerReady: true,
  maskedPhoneNumber: null,
  senderPhoneNumber: null,
  consentEpoch: 0,
  country: null,
  verifiedAt: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  h.owner = "owner";
  h.epoch = 1;
  h.buttons = [];
  h.api.getNotificationStatus.mockResolvedValue(notificationStatus());
  h.api.getTextingConnection.mockResolvedValue(disconnected);
  h.open.mockResolvedValue(undefined);
  h.api.saveNotificationPreferences.mockImplementation(async (scope, input) => ({
    scope,
    revision: 3,
    preferences: input.preferences,
  }));
});
afterEach(cleanup);
it("places device controls first and links compact summaries to dedicated native policy pages", async () => {
  render(wrap(<NotificationsSettingsScreen />));
  await screen.findByText("On · Quiet Hours");
  const global = screen.getByRole("button", { name: /^Global Policy/ });
  expect(screen.queryByText("Save policy")).toBeNull();
  expect(screen.queryByLabelText("Repeat after days")).toBeNull();
  expect(
    screen.getByText("iPhone device notifications").compareDocumentPosition(global) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(global).toHaveTextContent("On · Quiet Hours");
  expect(screen.getByRole("button", { name: /Finances Policy/ })).toHaveTextContent(
    "Uses Global Policy",
  );
  fireEvent.click(global);
  expect(h.push).toHaveBeenLastCalledWith("/settings/notifications/global");
  fireEvent.click(screen.getByRole("button", { name: /Finances Policy/ }));
  expect(h.push).toHaveBeenLastCalledWith("/settings/notifications/finances");
  fireEvent.click(screen.getByRole("button", { name: /Texting/ }));
  expect(h.push).toHaveBeenLastCalledWith("/settings/texting");
});
it("keeps the device root usable after a failed policy read and retries authoritative summaries", async () => {
  h.api.getNotificationStatus.mockRejectedValueOnce(new Error("Offline"));
  render(wrap(<NotificationsSettingsScreen />));
  expect(screen.getByText("iPhone device notifications")).toBeVisible();
  fireEvent.click(await screen.findByText("Retry loading"));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /^Global Policy/ })).toHaveTextContent(
      "On · Quiet Hours",
    ),
  );
  expect(h.error).toHaveBeenCalled();
});
it("retains invalid correction on child page and keeps revision recovery explicit after failed Save", async () => {
  render(wrap(<GlobalNotificationPolicyScreen />));
  const reminder = await screen.findByLabelText("Repeat after days");
  fireEvent.change(reminder, { target: { value: "0" } });
  fireEvent.click(screen.getByText("Save policy"));
  expect(h.api.saveNotificationPreferences).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Repeat after days")).toHaveValue("0");
  fireEvent.change(reminder, { target: { value: "9" } });
  h.api.saveNotificationPreferences.mockRejectedValueOnce(new Error("Changed elsewhere"));
  fireEvent.click(screen.getByText("Save policy"));
  await screen.findByText("Load latest global policy for review");
  expect(screen.getByLabelText("Repeat after days")).toHaveValue("9");
  h.api.getNotificationStatus.mockResolvedValue(notificationStatus(4));
  fireEvent.click(screen.getByText("Load latest global policy for review"));
  await waitFor(() => expect(h.buttons.some((b) => b.text === "Continue")).toBe(true));
  act(() => h.buttons.find((b) => b.text === "Continue")?.onPress?.());
  expect(h.api.saveNotificationPreferences).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByText("Save policy"));
  await waitFor(() => expect(h.api.saveNotificationPreferences).toHaveBeenCalledTimes(2));
  expect(h.api.saveNotificationPreferences).toHaveBeenLastCalledWith("global", {
    expectedRevision: 4,
    preferences: { ...defaultNotificationPreferences, reminderDays: 9 },
  });
});
it("Finance child inherits global values and saves an explicit override only for Finance", async () => {
  render(wrap(<FinanceNotificationPolicyScreen />));
  await screen.findByText("Using global preferences. Saving creates a Finances override.");
  fireEvent.change(screen.getByLabelText("Repeat after days"), { target: { value: "10" } });
  fireEvent.click(screen.getByText("Save policy"));
  await waitFor(() =>
    expect(h.api.saveNotificationPreferences).toHaveBeenCalledWith("finances", {
      expectedRevision: null,
      preferences: { ...defaultNotificationPreferences, reminderDays: 10 },
    }),
  );
});
it("unavailable deployment offers honest read-only status, legal links and refresh without setup inputs", async () => {
  h.api.getTextingConnection.mockResolvedValue({ ...disconnected, providerReady: false });
  render(wrap(<TextingSettingsScreen />));
  await screen.findByText(/Phone setup and verification are unavailable/);
  expect(screen.queryByLabelText("Mobile number")).toBeNull();
  expect(screen.queryByLabelText("Verification code")).toBeNull();
  expect(screen.queryByText("Send verification code")).toBeNull();
  expect(screen.queryByText("Disconnect texting")).toBeNull();
  fireEvent.click(screen.getByText("Privacy policy"));
  await waitFor(() => expect(h.open).toHaveBeenCalledWith("https://nohmi.coopersully.me/privacy/"));
  fireEvent.click(screen.getByText("Refresh texting status"));
  await waitFor(() => expect(h.api.getTextingConnection).toHaveBeenCalledTimes(2));
  expect(h.api.startTextingVerification).not.toHaveBeenCalled();
  expect(h.api.checkTextingVerification).not.toHaveBeenCalled();
});
it("read retry and unavailable-to-available refresh expose setup only after confirmed capability", async () => {
  h.api.getTextingConnection.mockRejectedValueOnce(new Error("Offline"));
  h.api.getTextingConnection.mockResolvedValueOnce({ ...disconnected, providerReady: false });
  render(wrap(<TextingSettingsScreen />));
  fireEvent.click(await screen.findByText("Retry loading"));
  await screen.findByText(/Phone setup and verification are unavailable/);
  h.api.getTextingConnection.mockResolvedValue(disconnected);
  fireEvent.click(screen.getByText("Refresh texting status"));
  await screen.findByLabelText("Mobile number");
  expect(screen.getByRole("button", { name: "Send verification code" })).toBeDisabled();
  expect(h.api.startTextingVerification).not.toHaveBeenCalled();
});

it("does not expose setup or claim a refreshed capability after an unavailable-status refresh fails", async () => {
  h.api.getTextingConnection.mockResolvedValue({ ...disconnected, providerReady: false });
  render(wrap(<TextingSettingsScreen />));
  await screen.findByText(/Phone setup and verification are unavailable/);
  h.api.getTextingConnection.mockRejectedValueOnce(new Error("Offline"));
  fireEvent.click(screen.getByText("Refresh texting status"));
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(screen.queryByLabelText("Mobile number")).toBeNull();
  expect(h.success).not.toHaveBeenCalled();
  expect(screen.queryByText("Offline")).toBeNull();
});
it("isolates retained policy drafts when authenticated owner changes", async () => {
  const view = render(wrap(<GlobalNotificationPolicyScreen />));
  fireEvent.change(await screen.findByLabelText("Repeat after days"), { target: { value: "9" } });
  h.owner = "second-owner";
  h.epoch = 2;
  view.rerender(wrap(<GlobalNotificationPolicyScreen />));
  await waitFor(() => expect(screen.getByLabelText("Repeat after days")).toHaveValue("7"));
  expect(h.api.saveNotificationPreferences).not.toHaveBeenCalled();
});

it("keeps floating Save outside scroll content and guards dirty or pending policy edits", async () => {
  let resolve: (value: unknown) => void = () => {};
  h.api.saveNotificationPreferences.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  render(wrap(<GlobalNotificationPolicyScreen />));
  await screen.findByLabelText("Repeat after days");
  const save = screen.getByRole("button", { name: "Save policy" });
  expect(screen.getByTestId("form-scroll").contains(save)).toBe(false);
  expect(save).toBeDisabled();
  expect(h.prevent).toBe(false);
  fireEvent.change(screen.getByLabelText("Repeat after days"), { target: { value: "9" } });
  expect(save).not.toBeDisabled();
  expect(h.prevent).toBe(true);
  fireEvent.click(save);
  await waitFor(() => expect(h.api.saveNotificationPreferences).toHaveBeenCalledOnce());
  expect(save).toBeDisabled();
  expect(h.prevent).toBe(true);
  await act(async () =>
    resolve({ revision: 3, preferences: { ...defaultNotificationPreferences, reminderDays: 9 } }),
  );
  await waitFor(() => expect(h.success).toHaveBeenCalled());
  expect(save).toBeDisabled();
  expect(h.prevent).toBe(false);
});

it("keeps the connected phone and consent inspectable during outage and requires named confirmed disconnect", async () => {
  const connected = {
    ...disconnected,
    id: "phone",
    state: "active",
    providerReady: false,
    maskedPhoneNumber: "••••1234",
    consentEpoch: 2,
  };
  h.api.getTextingConnection.mockResolvedValue(connected);
  let resolve: () => void = () => {};
  h.api.disconnectTexting.mockImplementation(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  render(wrap(<TextingSettingsScreen />));
  await screen.findByText("••••1234");
  expect(screen.getByText("Granted")).toBeVisible();
  expect(screen.getByText("active")).toBeVisible();
  expect(screen.queryByLabelText("Mobile number")).toBeNull();
  expect(screen.queryByLabelText("Verification code")).toBeNull();
  fireEvent.click(screen.getByText("Disconnect texting"));
  expect(h.api.disconnectTexting).not.toHaveBeenCalled();
  expect(h.alertMessage).toContain("••••1234");
  act(() => h.buttons.find((button) => button.text === "Continue")?.onPress?.());
  await waitFor(() => expect(h.api.disconnectTexting).toHaveBeenCalledOnce());
  expect(h.prevent).toBe(true);
  expect(h.dismissAction?.disabled).toBe(true);
  expect(screen.getByRole("button", { name: "Disconnect texting" })).toBeDisabled();
  h.api.getTextingConnection.mockResolvedValue({ ...disconnected, providerReady: false });
  await act(async () => resolve());
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Texting disconnected", { id: "toast" }),
  );
  expect(screen.queryByText("Disconnect texting")).toBeNull();
  expect(h.api.startTextingVerification).not.toHaveBeenCalled();
});
it("retains setup dismissal protection through outage and safely cancels an already requested challenge", async () => {
  h.api.startTextingVerification.mockResolvedValue({
    id: "challenge",
    status: "pending",
    maskedPhoneNumber: "••••1234",
    expiresAt: new Date(Date.now() + 600000).toISOString(),
  });
  render(wrap(<TextingSettingsScreen />));
  fireEvent.change(await screen.findByLabelText("Mobile number"), {
    target: { value: "4155552671" },
  });
  fireEvent.click(screen.getByLabelText("Allow agent text messages"));
  fireEvent.click(screen.getByText("Send verification code"));
  await screen.findByLabelText("Verification code");
  h.api.getTextingConnection.mockResolvedValue({ ...disconnected, providerReady: false });
  act(() => h.foreground?.());
  await screen.findByText(/Phone setup and verification are unavailable/);
  expect(screen.queryByLabelText("Verification code")).toBeNull();
  expect(h.prevent).toBe(true);
  expect(h.dismissAction?.label).toBe("Cancel");
  act(() => h.dismissAction?.onPress());
  expect(h.back).not.toHaveBeenCalled();
  expect(h.alertMessage).toContain("code already requested may still arrive");
  fireEvent.click(screen.getByText("Cancel phone setup"));
  act(() => h.buttons.find((button) => button.text === "Continue")?.onPress?.());
  await waitFor(() => expect(h.prevent).toBe(false));
  expect(screen.queryByText("Cancel phone setup")).toBeNull();
  h.api.getTextingConnection.mockResolvedValue(disconnected);
  fireEvent.click(screen.getByText("Refresh texting status"));
  await screen.findByLabelText("Mobile number");
  expect(screen.getByLabelText("Mobile number")).toHaveValue("");
  expect(screen.getByLabelText("Allow agent text messages")).not.toBeChecked();
  expect(h.api.startTextingVerification).toHaveBeenCalledOnce();
  expect(h.api.checkTextingVerification).not.toHaveBeenCalled();
});
