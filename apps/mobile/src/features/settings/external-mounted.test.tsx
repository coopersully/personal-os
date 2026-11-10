// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MobileDataProvider } from "../tasks/data";
import { ConnectionsSettingsScreen } from "./connections";
import { NotificationsSettingsScreen } from "./notifications";
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
  resources: {} as Record<string, unknown>,
  pending: false,
  signedIn: true,
  modalDismiss: undefined as (() => void) | undefined,
  allowSwipeDismissal: undefined as boolean | undefined,
  refetch: vi.fn(async () => ({})),
  confirm: vi.fn(),
  confirmation: undefined as (() => void) | undefined,
  open: vi.fn(async () => {}),
  success: vi.fn(),
  loading: vi.fn(() => "external-toast"),
  dismiss: vi.fn(),
  back: vi.fn(),
  push: vi.fn(),
  close: undefined as (() => void) | undefined,
  error: vi.fn(),
  api: {
    getGoogleAuthorizationUrl: vi.fn(),
    getXBookmarkAuthorizationUrl: vi.fn(),
    syncConnector: vi.fn(),
    selectXBookmarkFolder: vi.fn(),
    connectICloud: vi.fn(),
    startTextingVerification: vi.fn(),
    checkTextingVerification: vi.fn(),
    saveNotificationPreferences: vi.fn(),
    getNotificationStatus: vi.fn(),
    resetFinanceNotificationPreferences: vi.fn(),
    deleteConnector: vi.fn(),
    listConnectors: vi.fn(),
    getXBookmarkAccount: vi.fn(),
    listXBookmarkFolders: vi.fn(),
    syncXBookmarks: vi.fn(),
    deleteXBookmarkAccount: vi.fn(),
    getTextingConnection: vi.fn(),
    disconnectTexting: vi.fn(),
  },
  listeners: [] as ((state: string) => void)[],
}));
vi.mock("../auth/context", () => {
  const session = { epoch: () => 1, api: () => h.api };
  return {
    useOptionalAuth: () => null,
    useAuth: () => ({ state: { user: h.signedIn ? { id: "external-fixture" } : null }, session }),
  };
});
vi.mock("react-native", () => ({
  View: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Text: ({ children }: PropsWithChildren) => <span>{children}</span>,
  Modal: ({
    children,
    visible,
    onRequestClose,
    allowSwipeDismissal,
  }: PropsWithChildren<{
    visible: boolean;
    onRequestClose: () => void;
    allowSwipeDismissal: boolean;
  }>) => {
    h.modalDismiss = onRequestClose;
    h.allowSwipeDismissal = allowSwipeDismissal;
    return visible ? <div>{children}</div> : null;
  },
  Linking: { openURL: h.open },
  AppState: {
    addEventListener: (_name: string, listener: (state: string) => void) => {
      h.listeners.push(listener);
      return { remove: vi.fn() };
    },
  },
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("../../theme", () => ({ useTheme: () => ({}) }));
vi.mock("../../components/sheet-header", () => ({
  SheetHeader: ({ title, onClose }: { title: string; onClose: () => void }) => (
    <div>
      {title}
      <button type="button" onClick={onClose}>
        Close sheet
      </button>
    </div>
  ),
}));
vi.mock("../../components/editor-header", () => ({
  editorDismissOptions: ({ onPress }: { onPress: () => void }) => {
    h.close = onPress;
    return {};
  },
}));
vi.mock("expo-router", () => ({
  router: { push: h.push, back: h.back },
  Stack: { Screen: () => null },
}));
vi.mock("../notifications/provider", () => ({
  NotificationSettings: () => <div>Native notification controls</div>,
}));
vi.mock("./settings-row", () => ({
  SettingsRow: ({ label, onPress }: { label: string; onPress: () => void }) => (
    <button type="button" onClick={onPress}>
      {label}
    </button>
  ),
}));
vi.mock("sonner-native", () => ({
  toast: { error: h.error, success: h.success, loading: h.loading, dismiss: h.dismiss },
}));
vi.mock("./profile-time", () => ({
  ProfileTime: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: number;
    onChange: (value: number) => void;
  }) => (
    <input aria-label={label} value={value} onChange={(e) => onChange(Number(e.target.value))} />
  ),
}));
vi.mock("../tasks/searchable-choice", () => ({
  SearchableChoice: ({
    label,
    value,
    options,
    onChange,
    disabled,
  }: {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
    disabled: boolean;
  }) => (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock("../tasks/ui", () => ({
  FormBody: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Section: ({ children, title }: PropsWithChildren<{ title?: string }>) => (
    <section aria-label={title}>{children}</section>
  ),
  Field: ({
    label,
    value,
    onChangeText,
    secureTextEntry,
    editable = true,
  }: {
    label: string;
    value: string;
    onChangeText: (value: string) => void;
    secureTextEntry: boolean;
    editable?: boolean;
  }) => (
    <input
      aria-label={label}
      type={secureTextEntry ? "password" : "text"}
      value={value}
      disabled={!editable}
      onChange={(e) => onChangeText(e.target.value)}
    />
  ),
  ToggleRow: ({
    label,
    value,
    onChange,
    disabled,
  }: {
    label: string;
    value: boolean;
    onChange: (value: boolean) => void;
    disabled: boolean;
  }) => (
    <label>
      {label}
      <input
        aria-label={label}
        type="checkbox"
        checked={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  ),
  Choice: ({
    label,
    value,
    options,
    onChange,
  }: {
    label: string;
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
  }) => (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  Action: ({
    label,
    onPress,
    disabled,
  }: {
    label: string;
    onPress: () => void;
    disabled: boolean;
  }) => (
    <button type="button" onClick={onPress} disabled={disabled}>
      {label}
    </button>
  ),
  State: ({ loading, retry, empty }: { loading?: boolean; retry?: () => void; empty?: string }) =>
    loading ? (
      <span>Loading data</span>
    ) : retry ? (
      <button type="button" onClick={retry}>
        Retry data
      </button>
    ) : (
      <span>{empty}</span>
    ),
  confirm: (title: string, message: string, accept: () => void) => {
    h.confirm(title, message);
    h.confirmation = accept;
  },
}));
const preferences = {
  enabled: true,
  quietMode: "window",
  quietStartMinute: 1320,
  quietEndMinute: 480,
  reminderDays: 7,
  detail: "context",
};
const policy = () => ({
  timeZone: "UTC",
  capability: "available",
  reason: null,
  effective: preferences,
  preferences: [
    { scope: "global", revision: 4, preferences },
    { scope: "finances", revision: 9, preferences: { ...preferences, detail: "minimal" } },
  ],
});
const account = () => ({
  id: "google",
  label: "Sample Google",
  provider: "google",
  email: "fixture@nohmi.test",
  mailEnabled: true,
  calendarEnabled: false,
  lastSyncedAt: null,
  syncStatus: "idle",
  health: { state: "ready", message: null },
  capabilities: { mail: { health: { state: "reconnect" } } },
});
const disconnected = () => ({
  providerReady: true,
  id: null,
  state: null,
  maskedPhoneNumber: null,
  senderPhoneNumber: null,
});
beforeEach(() => {
  vi.clearAllMocks();
  for (const method of Object.values(h.api)) method.mockReset();
  h.close = undefined;
  h.listeners = [];
  h.confirmation = undefined;
  h.pending = false;
  h.signedIn = true;
  h.resources = {
    connectors: [],
    "x-account": null,
    "x-folders": [],
    texting: disconnected(),
    policy: policy(),
  };
  h.api.listConnectors.mockImplementation(async () => h.resources.connectors);
  h.api.getXBookmarkAccount.mockImplementation(async () => h.resources["x-account"]);
  h.api.listXBookmarkFolders.mockImplementation(async () => h.resources["x-folders"]);
  h.api.getTextingConnection.mockImplementation(async () => h.resources.texting);
  h.api.getNotificationStatus.mockImplementation(async () => h.resources.policy);
  h.api.getGoogleAuthorizationUrl.mockResolvedValue("https://accounts.google.com/fixture");
  h.api.getXBookmarkAuthorizationUrl.mockResolvedValue("https://x.com/fixture");
  h.api.deleteConnector.mockResolvedValue(undefined);
  h.api.deleteXBookmarkAccount.mockResolvedValue(undefined);
  h.api.disconnectTexting.mockResolvedValue(undefined);
  h.api.resetFinanceNotificationPreferences.mockResolvedValue({
    scope: "finances",
    inherited: true,
  });
  h.api.saveNotificationPreferences.mockImplementation(async (scope, input) => ({
    scope,
    revision: (input.expectedRevision ?? 0) + 1,
    preferences: input.preferences,
  }));
  h.api.startTextingVerification.mockResolvedValue({
    id: "challenge",
    status: "pending",
    maskedPhoneNumber: "***0123",
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  });
  h.open.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);
const show = (children: React.ReactNode) =>
  render(<MobileDataProvider>{children}</MobileDataProvider>);
const confirm = () =>
  act(async () => {
    h.confirmation?.();
  });
const enroll = async () => {
  await screen.findByLabelText("Mobile number");
  fireEvent.change(screen.getByLabelText("Mobile number"), { target: { value: "5555550123" } });
  fireEvent.click(screen.getByLabelText("Allow agent text messages"));
  fireEvent.click(screen.getByText("Send verification code"));
  await screen.findByLabelText("Verification code");
};
it("reconnects only the current Google services after confirmation and reports browser rejection honestly", async () => {
  h.resources.connectors = [account()];
  h.open.mockRejectedValueOnce(new Error("No browser"));
  show(<ConnectionsSettingsScreen />);
  await screen.findByText("Sample Google");
  fireEvent.click(screen.getByText("Reconnect in browser"));
  expect(h.api.getGoogleAuthorizationUrl).not.toHaveBeenCalled();
  await confirm();
  await waitFor(() =>
    expect(h.api.getGoogleAuthorizationUrl).toHaveBeenCalledWith({
      accountId: "google",
      returnTo: "/settings?section=connections",
      services: ["mail"],
    }),
  );
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(h.success).not.toHaveBeenCalled();
  expect(screen.queryByText("No browser")).toBeNull();
});
it("confirms pending/settled sync outcomes and named disconnect without treating cancellation as mutation", async () => {
  h.resources.connectors = [account()];
  h.api.syncConnector
    .mockResolvedValueOnce({ pending: true, changed: 0 })
    .mockResolvedValueOnce({ pending: false, changed: 3 });
  show(<ConnectionsSettingsScreen />);
  await screen.findByText("Sample Google");
  fireEvent.click(screen.getByText("Sync now"));
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Sync requested. Check account status for completion.", {
      id: "external-toast",
    }),
  );
  fireEvent.click(screen.getByText("Sync now"));
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Sync confirmed: 3 changes.", { id: "external-toast" }),
  );
  fireEvent.click(screen.getByText("Disconnect account"));
  expect(h.confirm).toHaveBeenLastCalledWith("Disconnect Sample Google?", expect.any(String));
  expect(h.api.deleteConnector).not.toHaveBeenCalled();
  await confirm();
  await waitFor(() => expect(h.api.deleteConnector).toHaveBeenCalledWith("google"));
  expect(h.loading).toHaveBeenCalledTimes(3);
});
it("refreshes Google/X status on foreground and returns failed explicit reads through Sonner while preserving cached accounts", async () => {
  h.resources.connectors = [account()];
  show(<ConnectionsSettingsScreen />);
  await screen.findByText("Sample Google");
  const before = h.api.listConnectors.mock.calls.length;
  act(() => {
    for (const listener of h.listeners) listener("active");
  });
  await waitFor(() => expect(h.api.listConnectors.mock.calls.length).toBeGreaterThan(before));
  h.api.listConnectors.mockRejectedValueOnce(new Error("Unavailable"));
  fireEvent.click(screen.getByText("Refresh connections"));
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(screen.getByText("Sample Google")).toBeTruthy();
  expect(screen.queryByText("Unavailable")).toBeNull();
});
it("supports X folder recovery, sync and explicit browser reconnect/disconnect using existing server identity", async () => {
  h.resources["x-account"] = {
    id: "x",
    username: "fixture",
    syncStatus: "idle",
    selectedFolderId: "remote-old",
    selectedFolderName: "Saved",
  };
  h.resources["x-folders"] = [{ id: "local", remoteFolderId: "remote-new", name: "Reading" }];
  h.api.selectXBookmarkFolder.mockResolvedValue(1);
  h.api.syncXBookmarks.mockResolvedValue(2);
  show(<ConnectionsSettingsScreen />);
  await screen.findByText("@fixture · idle");
  await screen.findByRole("option", { name: "Reading" });
  fireEvent.change(screen.getByLabelText("Bookmark folder"), { target: { value: "remote-new" } });
  await waitFor(() => expect(h.api.selectXBookmarkFolder).toHaveBeenCalledWith("remote-new"));
  fireEvent.click(screen.getByText("Sync bookmarks"));
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Bookmark sync confirmed: 2 changes.", {
      id: "external-toast",
    }),
  );
  fireEvent.click(screen.getByText("Reconnect X in browser"));
  await confirm();
  await waitFor(() => expect(h.open).toHaveBeenCalledWith("https://x.com/fixture"));
  fireEvent.click(screen.getByText("Disconnect X"));
  await confirm();
  await waitFor(() => expect(h.api.deleteXBookmarkAccount).toHaveBeenCalledOnce());
});
it("saves notification quiet-mode/detail/reminder configuration using real revisioned writes and confirms Finance reset", async () => {
  show(<NotificationsSettingsScreen />);
  await screen.findByText("Save global text policy");
  fireEvent.change(screen.getAllByLabelText("Quiet hours")[0], { target: { value: "any_time" } });
  fireEvent.change(screen.getAllByLabelText("Message detail")[0], { target: { value: "minimal" } });
  fireEvent.click(screen.getAllByLabelText("Repeat reminders")[0]);
  fireEvent.click(screen.getByText("Save global text policy"));
  await waitFor(() =>
    expect(h.api.saveNotificationPreferences).toHaveBeenCalledWith("global", {
      expectedRevision: 4,
      preferences: { ...preferences, quietMode: "any_time", detail: "minimal", reminderDays: null },
    }),
  );
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Text-message policy saved", { id: "external-toast" }),
  );
  fireEvent.click(screen.getByText("Use global text policy"));
  expect(h.api.resetFinanceNotificationPreferences).not.toHaveBeenCalled();
  await confirm();
  await waitFor(() =>
    expect(h.api.resetFinanceNotificationPreferences).toHaveBeenCalledWith({ expectedRevision: 9 }),
  );
  await screen.findByText("Using global preferences. Saving creates a Finances override.");
});
it("retains invalid policy days and permits explicit draft discard instead of writing invalid values", async () => {
  show(<NotificationsSettingsScreen />);
  await screen.findByText("Save global text policy");
  fireEvent.change(screen.getAllByLabelText("Repeat after days")[0], { target: { value: "bad" } });
  fireEvent.click(screen.getByText("Save global text policy"));
  expect(h.error).toHaveBeenCalled();
  expect(h.api.saveNotificationPreferences).not.toHaveBeenCalled();
  expect((screen.getAllByLabelText("Repeat after days")[0] as HTMLInputElement).value).toBe("bad");
  fireEvent.click(screen.getByText("Discard policy changes"));
  await confirm();
  expect((screen.getAllByLabelText("Repeat after days")[0] as HTMLInputElement).value).toBe("7");
});
it("recovers a denied reset and declines review without adopting a remote revision", async () => {
  h.api.resetFinanceNotificationPreferences.mockRejectedValueOnce(new Error("Offline"));
  show(<NotificationsSettingsScreen />);
  await screen.findByText("Use global text policy");
  fireEvent.click(screen.getByText("Use global text policy"));
  await confirm();
  await screen.findByText("Load latest finances policy for review");
  expect((screen.getByText("Use global text policy") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByText("Load latest finances policy for review"));
  await waitFor(() =>
    expect(h.confirm).toHaveBeenLastCalledWith("Review latest policy", expect.any(String)),
  );
  expect((screen.getByText("Use global text policy") as HTMLButtonElement).disabled).toBe(true);
  expect(h.api.resetFinanceNotificationPreferences).toHaveBeenCalledTimes(1);
});
it("enforces current SMS consent/provider availability and retains pending code across foreground/error until confirmed connection", async () => {
  h.api.checkTextingVerification
    .mockRejectedValueOnce(new Error("Wrong code"))
    .mockResolvedValueOnce({
      ...disconnected(),
      id: "phone",
      state: "active",
      maskedPhoneNumber: "***0123",
    });
  show(<TextingSettingsScreen />);
  await screen.findByLabelText("Mobile number");
  expect((screen.getByText("Send verification code") as HTMLButtonElement).disabled).toBe(true);
  await enroll();
  expect(h.api.startTextingVerification).toHaveBeenCalledWith({
    country: "US",
    phoneNumber: "5555550123",
    consentAccepted: true,
    consentVersion: "2026-10-07-v2",
  });
  fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "123456" } });
  act(() => {
    for (const listener of h.listeners) listener("active");
  });
  expect((screen.getByLabelText("Verification code") as HTMLInputElement).value).toBe("123456");
  fireEvent.click(screen.getByText("Verify and connect"));
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect((screen.getByLabelText("Verification code") as HTMLInputElement).value).toBe("123456");
  fireEvent.click(screen.getByText("Verify and connect"));
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Phone connection confirmed", { id: "external-toast" }),
  );
  expect(h.api.checkTextingVerification).toHaveBeenLastCalledWith("challenge", { code: "123456" });
});
it("marks expired SMS challenges honestly, permits explicit start-again and never retries send automatically", async () => {
  h.api.startTextingVerification.mockResolvedValueOnce({
    id: "expired",
    status: "pending",
    maskedPhoneNumber: "***0123",
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  });
  show(<TextingSettingsScreen />);
  await enroll();
  expect(screen.getByText(/This code has expired/)).toBeTruthy();
  expect((screen.getByText("Verify and connect") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByText("Start again"));
  expect(screen.getByLabelText("Mobile number")).toBeTruthy();
  expect(h.api.startTextingVerification).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByText("Cancel phone setup"));
  await confirm();
  expect(h.api.startTextingVerification).toHaveBeenCalledOnce();
});
it("does not claim a failed/expired start challenge succeeded, supports country and legal links, and keeps consent optional", async () => {
  h.api.startTextingVerification.mockResolvedValueOnce({
    id: "failed",
    status: "failed",
    maskedPhoneNumber: "***0123",
    expiresAt: new Date().toISOString(),
  });
  show(<TextingSettingsScreen />);
  await screen.findByLabelText("Mobile number");
  fireEvent.change(screen.getByLabelText("Country"), { target: { value: "CA" } });
  fireEvent.click(screen.getByText("Privacy policy"));
  await waitFor(() => expect(h.open).toHaveBeenCalledWith("https://nohmi.coopersully.me/privacy/"));
  fireEvent.click(screen.getByText("Terms of use"));
  await waitFor(() => expect(h.open).toHaveBeenCalledWith("https://nohmi.coopersully.me/terms/"));
  fireEvent.click(screen.getByText("SMS terms"));
  await waitFor(() => expect(h.open).toHaveBeenCalledWith("https://nohmi.coopersully.me/sms/"));
  fireEvent.change(screen.getByLabelText("Mobile number"), { target: { value: "5555550123" } });
  fireEvent.click(screen.getByLabelText("Allow agent text messages"));
  fireEvent.click(screen.getByText("Send verification code"));
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "Verification failed. Start again to request another code.",
      { id: "external-toast" },
    ),
  );
  expect(h.api.startTextingVerification).toHaveBeenCalledWith(
    expect.objectContaining({ country: "CA" }),
  );
  expect(screen.queryByLabelText("Verification code")).toBeNull();
});
it("keeps an actual pending iCloud submission guarded until the server confirms it", async () => {
  let finish!: (value: unknown) => void;
  h.api.connectICloud.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
  show(<ConnectionsSettingsScreen />);
  await screen.findByText("Connect iCloud");
  fireEvent.click(screen.getByText("Connect iCloud"));
  fireEvent.change(screen.getByLabelText("Apple Account"), {
    target: { value: "alex@icloud.com" },
  });
  fireEvent.change(screen.getByLabelText("App-specific password"), {
    target: { value: "abcd-efgh" },
  });
  fireEvent.click(screen.getByText("Connect account"));
  await waitFor(() => expect(h.api.connectICloud).toHaveBeenCalled());
  const confirmations = h.confirm.mock.calls.length;
  act(() => h.modalDismiss?.());
  expect(h.confirm).toHaveBeenCalledTimes(confirmations);
  expect(screen.getByLabelText("App-specific password")).toBeTruthy();
  await act(async () => finish({ accountId: "icloud", email: "alex@icloud.com" }));
  await waitFor(() => expect(screen.queryByLabelText("App-specific password")).toBeNull());
  expect(h.success).toHaveBeenCalledWith("iCloud connection confirmed", { id: "external-toast" });
});
it("shows provider unavailability without sending and requires named confirmation for active destination disconnect", async () => {
  h.resources.texting = { ...disconnected(), providerReady: false };
  const first = show(<TextingSettingsScreen />);
  await screen.findByLabelText("Mobile number");
  fireEvent.change(screen.getByLabelText("Mobile number"), { target: { value: "5555550123" } });
  fireEvent.click(screen.getByLabelText("Allow agent text messages"));
  expect((screen.getByText("Send verification code") as HTMLButtonElement).disabled).toBe(true);
  expect(h.api.startTextingVerification).not.toHaveBeenCalled();
  first.unmount();
  h.resources.texting = {
    ...disconnected(),
    id: "phone",
    state: "active",
    maskedPhoneNumber: "***0123",
    senderPhoneNumber: "+15555550199",
  };
  show(<TextingSettingsScreen />);
  await screen.findByText("Change phone number");
  fireEvent.click(screen.getByText("Change phone number"));
  expect(screen.getByLabelText("Mobile number")).toBeTruthy();
  fireEvent.click(screen.getByText("Cancel phone setup"));
  await confirm();
  expect(screen.queryByLabelText("Mobile number")).toBeNull();
  fireEvent.click(screen.getByText("Disconnect texting"));
  expect(h.api.disconnectTexting).not.toHaveBeenCalled();
  await confirm();
  await waitFor(() => expect(h.api.disconnectTexting).toHaveBeenCalledOnce());
  expect(h.success).toHaveBeenCalledWith("Texting disconnected", { id: "external-toast" });
});
it("treats an approved start and non-active verification as state checks without a false active-connection message", async () => {
  h.api.startTextingVerification.mockResolvedValueOnce({
    id: "approved",
    status: "approved",
    maskedPhoneNumber: "***0123",
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  });
  h.api.checkTextingVerification.mockResolvedValueOnce({
    ...disconnected(),
    id: "phone",
    state: "suspended",
  });
  show(<TextingSettingsScreen />);
  await enroll();
  await waitFor(() => expect(h.api.getTextingConnection.mock.calls.length).toBeGreaterThan(1));
  expect(h.success).toHaveBeenCalledWith("Verification approved. Checking the connection.", {
    id: "external-toast",
  });
  fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "123456" } });
  fireEvent.click(screen.getByText("Verify and connect"));
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith(
      "Phone verification checked. Review the current state.",
      { id: "external-toast" },
    ),
  );
  expect(screen.getByLabelText("Verification code")).toBeTruthy();
  expect(h.success).not.toHaveBeenCalledWith("Phone connection confirmed", expect.anything());
});

it("recovers failed initial connector, X and folder reads through their actual query retry controls", async () => {
  h.api.listConnectors.mockRejectedValueOnce(new Error("No connectors"));
  h.api.getXBookmarkAccount.mockRejectedValueOnce(new Error("No X status"));
  const first = show(<ConnectionsSettingsScreen />);
  await waitFor(() => expect(screen.getAllByText("Retry data")).toHaveLength(2));
  for (const button of screen.getAllByText("Retry data")) fireEvent.click(button);
  await screen.findByText("No connected accounts.");
  await screen.findByText("No X account connected.");
  expect(h.api.listConnectors).toHaveBeenCalledTimes(2);
  expect(h.api.getXBookmarkAccount).toHaveBeenCalledTimes(2);
  first.unmount();
  h.resources["x-account"] = {
    id: "x",
    username: "fixture",
    syncStatus: "error",
    syncError: "Needs attention",
    selectedFolderId: "old",
    selectedFolderName: "Previous",
  };
  h.resources["x-folders"] = [{ id: "local", remoteFolderId: "next", name: "Next folder" }];
  h.api.listXBookmarkFolders.mockRejectedValueOnce(new Error("Folders unavailable"));
  show(<ConnectionsSettingsScreen />);
  await screen.findByText("Retry loading folders");
  expect((screen.getByLabelText("Bookmark folder") as HTMLSelectElement).disabled).toBe(true);
  fireEvent.click(screen.getByText("Retry loading folders"));
  await screen.findByRole("option", { name: "Next folder" });
  expect((screen.getByLabelText("Bookmark folder") as HTMLSelectElement).disabled).toBe(false);
});
it("prefills iCloud reconnect identity/services and submits only its chosen capabilities", async () => {
  h.resources.connectors = [
    {
      ...account(),
      provider: "icloud",
      email: "alex@icloud.com",
      mailEnabled: false,
      calendarEnabled: true,
    },
  ];
  h.api.connectICloud.mockResolvedValue({ accountId: "icloud", email: "alex@icloud.com" });
  show(<ConnectionsSettingsScreen />);
  await screen.findByText("Update iCloud credentials");
  fireEvent.click(screen.getByText("Update iCloud credentials"));
  expect((screen.getByLabelText("Apple Account") as HTMLInputElement).value).toBe(
    "alex@icloud.com",
  );
  fireEvent.change(screen.getByLabelText("App-specific password"), {
    target: { value: "abcd-efgh" },
  });
  fireEvent.click(screen.getByText("Connect account"));
  await waitFor(() =>
    expect(h.api.connectICloud).toHaveBeenCalledWith({
      email: "alex@icloud.com",
      appSpecificPassword: "abcd-efgh",
      mail: false,
      calendar: true,
    }),
  );
});
it("retries unavailable notification policy, confirms dirty close, navigates Texting and saves disabled quiet-end changes", async () => {
  h.api.getNotificationStatus.mockRejectedValueOnce(new Error("Policy unavailable"));
  show(<NotificationsSettingsScreen />);
  await screen.findByText("Retry data");
  fireEvent.click(screen.getByText("Retry data"));
  await screen.findByText("Save global text policy");
  act(() => h.close?.());
  expect(h.back).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByText("Texting"));
  expect(h.push).toHaveBeenCalledWith("/settings/texting");
  fireEvent.click(screen.getAllByLabelText("Enabled")[0]);
  fireEvent.change(screen.getAllByLabelText("Quiet hours end")[0], { target: { value: "450" } });
  act(() => h.close?.());
  expect(h.confirm).toHaveBeenLastCalledWith("Discard policy changes?", expect.any(String));
  expect(h.back).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByText("Save global text policy"));
  await waitFor(() =>
    expect(h.api.saveNotificationPreferences).toHaveBeenCalledWith("global", {
      expectedRevision: 4,
      preferences: { ...preferences, enabled: false, quietEndMinute: 450 },
    }),
  );
});
it("retries unavailable texting status and guards close when the optional phone draft is dirty", async () => {
  h.api.getTextingConnection.mockRejectedValueOnce(new Error("Unavailable"));
  show(<TextingSettingsScreen />);
  await screen.findByText("Retry data");
  fireEvent.click(screen.getByText("Retry data"));
  await screen.findByLabelText("Mobile number");
  act(() => h.close?.());
  expect(h.back).toHaveBeenCalledOnce();
  fireEvent.change(screen.getByLabelText("Mobile number"), { target: { value: "5555550123" } });
  act(() => h.close?.());
  expect(h.confirm).toHaveBeenLastCalledWith("Leave phone setup?", expect.any(String));
  expect(h.api.startTextingVerification).not.toHaveBeenCalled();
  await confirm();
  expect(h.back).toHaveBeenCalledTimes(2);
});

it("does not expose protected account data after sign-out and tolerates unknown provider capability states", async () => {
  h.signedIn = false;
  const first = show(<ConnectionsSettingsScreen />);
  expect(h.api.listConnectors).not.toHaveBeenCalled();
  first.unmount();
  h.signedIn = true;
  h.resources.connectors = [
    {
      ...account(),
      id: "unknown",
      label: "Other provider",
      provider: "future",
      email: null,
      mailEnabled: false,
      calendarEnabled: false,
      capabilities: undefined,
      lastSyncedAt: "2026-11-10T12:00:00Z",
      syncStatus: "syncing",
      health: { state: "reconnect", message: "Reconnect required" },
    },
  ];
  show(<ConnectionsSettingsScreen />);
  await screen.findByText("Other provider");
  expect(screen.getByText("future")).toBeTruthy();
  expect(screen.getByText("No enabled services")).toBeTruthy();
  expect(screen.getByText("reconnect · Reconnect required")).toBeTruthy();
  expect((screen.getByText("Sync now") as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText("Reconnect in browser")).toBeNull();
});
it("validates iCloud identity and service choices before transport, retaining the entered secure draft", async () => {
  show(<ConnectionsSettingsScreen />);
  await screen.findByText("Connect iCloud");
  fireEvent.click(screen.getByText("Connect iCloud"));
  fireEvent.change(screen.getByLabelText("Apple Account"), { target: { value: "invalid" } });
  fireEvent.change(screen.getByLabelText("App-specific password"), {
    target: { value: "abcd-efgh" },
  });
  fireEvent.click(screen.getByText("Connect account"));
  expect(h.error).toHaveBeenCalled();
  expect(h.api.connectICloud).not.toHaveBeenCalled();
  expect((screen.getByLabelText("App-specific password") as HTMLInputElement).value).toBe(
    "abcd-efgh",
  );
});
it("creates first-time global policy from defaults and propagates accepted global changes to inherited Finances", async () => {
  h.resources.policy = {
    ...policy(),
    capability: "unavailable",
    reason: "producer_not_registered",
    preferences: [],
  };
  h.api.saveNotificationPreferences.mockImplementationOnce(async (scope, input) => {
    const result = { scope, revision: 1, preferences: input.preferences };
    h.resources.policy = { ...policy(), preferences: [result] };
    return result;
  });
  show(<NotificationsSettingsScreen />);
  await screen.findByText("Save global text policy");
  expect(screen.getByText(/unavailable: producer not registered/)).toBeTruthy();
  fireEvent.click(screen.getAllByLabelText("Repeat reminders")[0]);
  fireEvent.click(screen.getAllByLabelText("Repeat reminders")[0]);
  fireEvent.change(screen.getAllByLabelText("Repeat after days")[0], { target: { value: "12" } });
  fireEvent.click(screen.getByText("Save global text policy"));
  await waitFor(() =>
    expect(h.api.saveNotificationPreferences).toHaveBeenCalledWith("global", {
      expectedRevision: null,
      preferences: { ...preferences, reminderDays: 12 },
    }),
  );
  await waitFor(() =>
    expect((screen.getAllByLabelText("Repeat after days")[1] as HTMLInputElement).value).toBe("12"),
  );
  expect(h.api.saveNotificationPreferences).toHaveBeenCalledOnce();
});
it("keeps a denied conflict reload blocked, then separately saves a reviewed draft when the Finance override was removed elsewhere", async () => {
  h.api.saveNotificationPreferences
    .mockRejectedValueOnce(new Error("Conflict"))
    .mockResolvedValueOnce({
      scope: "finances",
      revision: 1,
      preferences: {
        ...preferences,
        enabled: false,
        quietMode: "any_time",
        reminderDays: null,
        detail: "minimal",
        quietStartMinute: 1300,
      },
    });
  show(<NotificationsSettingsScreen />);
  await screen.findByText("Save finances text policy");
  fireEvent.change(screen.getAllByLabelText("Quiet hours start")[1], { target: { value: "1300" } });
  fireEvent.click(screen.getByText("Save finances text policy"));
  await screen.findByText("Load latest finances policy for review");
  h.api.getNotificationStatus.mockRejectedValueOnce(new Error("Read denied"));
  fireEvent.click(screen.getByText("Load latest finances policy for review"));
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect((screen.getByText("Save finances text policy") as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getAllByLabelText("Quiet hours start")[1] as HTMLInputElement).value).toBe("1300");
  h.api.getNotificationStatus.mockResolvedValueOnce({
    ...policy(),
    preferences: [
      {
        scope: "global",
        revision: 6,
        preferences: {
          ...preferences,
          enabled: false,
          quietMode: "any_time",
          reminderDays: null,
          detail: "minimal",
        },
      },
    ],
  });
  fireEvent.click(screen.getByText("Load latest finances policy for review"));
  await waitFor(() =>
    expect(h.confirm).toHaveBeenLastCalledWith(
      "Review latest policy",
      expect.stringContaining("repeat after days: Off"),
    ),
  );
  expect(h.api.saveNotificationPreferences).toHaveBeenCalledOnce();
  await confirm();
  expect((screen.getByText("Save finances text policy") as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByText("Save finances text policy"));
  await waitFor(() =>
    expect(h.api.saveNotificationPreferences).toHaveBeenLastCalledWith("finances", {
      expectedRevision: null,
      preferences: {
        ...preferences,
        enabled: false,
        quietMode: "any_time",
        reminderDays: null,
        detail: "minimal",
        quietStartMinute: 1300,
      },
    }),
  );
});
it("uses actual selected Google services and does not attempt connection when no services are selected", async () => {
  show(<ConnectionsSettingsScreen />);
  await screen.findByText("No connected accounts.");
  fireEvent.click(screen.getByLabelText("Mail"));
  fireEvent.click(screen.getByText("Connect Google in browser"));
  await confirm();
  await waitFor(() =>
    expect(h.api.getGoogleAuthorizationUrl).toHaveBeenCalledWith({
      returnTo: "/settings?section=connections",
      services: ["calendar"],
    }),
  );
  fireEvent.click(screen.getByLabelText("Calendar"));
  expect((screen.getByText("Connect Google in browser") as HTMLButtonElement).disabled).toBe(true);
  expect(h.api.getGoogleAuthorizationUrl).toHaveBeenCalledOnce();
});
