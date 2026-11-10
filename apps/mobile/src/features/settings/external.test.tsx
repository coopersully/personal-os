// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ConnectionAccountScreen,
  ConnectionsSettingsScreen,
  openAuthorization,
} from "./connections";
import { NotificationsSettingsScreen } from "./notifications";
import { TextingSettingsScreen } from "./texting";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
const h = vi.hoisted(() => ({
  resources: {} as Record<string, unknown>,
  pending: false,
  navigate: vi.fn(),
  modalDismiss: undefined as (() => void) | undefined,
  allowSwipeDismissal: undefined as boolean | undefined,
  refetch: vi.fn(async () => ({})),
  confirm: vi.fn(),
  confirmation: undefined as (() => void) | undefined,
  open: vi.fn(async () => {}),
  success: vi.fn(),
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
  },
  listeners: [] as ((state: string) => void)[],
}));
vi.mock("../auth/context", () => ({
  useOptionalAuth: () => null,
  useAuth: () => ({ state: { user: { id: "fixture" } }, session: { epoch: () => 1 } }),
}));
vi.mock("./data", () => ({
  useSettingsResource: (key: string) => ({
    data: h.resources[key],
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: h.refetch,
  }),
  useSettingsAction: () => ({
    pending: h.pending,
    run: async (
      action: (api: typeof h.api) => Promise<unknown>,
      success?: string | ((result: unknown) => string),
    ) => {
      try {
        const value = await action(h.api);
        if (success) h.success(typeof success === "function" ? success(value) : success);
        return { ok: true, value };
      } catch (error) {
        h.error((error as Error).message);
        return { ok: false };
      }
    },
  }),
}));
vi.mock("../../components/icons", () => ({ Icon: () => <span /> }));
vi.mock("react-native", () => ({
  Pressable: ({
    children,
    onPress,
    accessibilityLabel,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    accessibilityLabel: string;
  }) => (
    <button type="button" aria-label={accessibilityLabel} onClick={onPress}>
      {children}
    </button>
  ),
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
vi.mock("../../components/editor-header", () => ({ editorDismissOptions: () => ({}) }));
vi.mock("expo-router", () => ({
  router: { push: h.navigate, back: vi.fn() },
  useLocalSearchParams: () => ({ id: "account" }),
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
vi.mock("sonner-native", () => ({ toast: { error: h.error, success: h.success } }));
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
  State: () => null,
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
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  h.confirmation = undefined;
  h.pending = false;
  h.modalDismiss = undefined;
  h.listeners = [];
  h.resources = {
    connectors: [],
    "x-account": null,
    texting: {
      providerReady: true,
      id: null,
      state: null,
      maskedPhoneNumber: null,
      senderPhoneNumber: null,
    },
    "notification-policy": {
      timeZone: "UTC",
      capability: "available",
      reason: null,
      effective: preferences,
      preferences: [{ scope: "global", revision: 4, preferences }],
    },
  };
});
it("hands Google authorization to the browser only after explicit confirmation and refreshes on return", async () => {
  h.api.getGoogleAuthorizationUrl.mockResolvedValue("https://accounts.google.com/oauth");
  render(<ConnectionsSettingsScreen />);
  expect(h.api.getGoogleAuthorizationUrl).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Connect Google in browser"));
  expect(h.api.getGoogleAuthorizationUrl).not.toHaveBeenCalled();
  await act(async () => h.confirmation?.());
  expect(h.api.getGoogleAuthorizationUrl).toHaveBeenCalledWith({
    returnTo: "/settings?section=connections",
    services: ["mail", "calendar"],
  });
  expect(h.open).toHaveBeenCalledWith("https://accounts.google.com/oauth");
  expect(h.success).toHaveBeenCalledWith(
    "Browser opened. Finish authorization, then return to nohmi.",
  );
  act(() =>
    h.listeners.forEach((listener) => {
      listener("active");
    }),
  );
  expect(h.refetch).toHaveBeenCalled();
});
it("rejects non-HTTPS authorization handoffs", async () => {
  await expect(openAuthorization("file:///etc/passwd")).rejects.toThrow();
  await expect(openAuthorization("https://user:password@example.com")).rejects.toThrow();
  expect(h.open).not.toHaveBeenCalled();
});
it("uses remote bookmark folder identity", async () => {
  h.resources["x-account"] = {
    id: "x",
    username: "fixture",
    syncStatus: "idle",
    selectedFolderId: "remote-old",
  };
  h.resources["x-folders"] = [{ id: "local", remoteFolderId: "remote-new", name: "Reading" }];
  h.api.selectXBookmarkFolder.mockResolvedValue(1);
  render(<ConnectionsSettingsScreen />);
  fireEvent.change(screen.getByLabelText("Bookmark folder"), { target: { value: "remote-new" } });
  await waitFor(() => expect(h.api.selectXBookmarkFolder).toHaveBeenCalledWith("remote-new"));
});
it("keeps failed iCloud credentials in the secure form and closes only after accepted setup", async () => {
  h.api.connectICloud
    .mockRejectedValueOnce(new Error("Rejected"))
    .mockResolvedValue({ accountId: "icloud", email: "alex@icloud.com" });
  render(<ConnectionsSettingsScreen />);
  fireEvent.click(screen.getByText("Connect iCloud"));
  fireEvent.change(screen.getByLabelText("Apple Account"), {
    target: { value: "alex@icloud.com" },
  });
  const password = screen.getByLabelText("App-specific password") as HTMLInputElement;
  expect(password.type).toBe("password");
  fireEvent.change(password, { target: { value: "abcd-efgh" } });
  fireEvent.click(screen.getByText("Connect account"));
  await waitFor(() => expect(h.error).toHaveBeenCalledWith("Rejected"));
  expect(password.value).toBe("abcd-efgh");
  expect(screen.queryByText("Rejected")).toBeNull();
  fireEvent.click(screen.getByText("Connect account"));
  await waitFor(() => expect(screen.queryByLabelText("App-specific password")).toBeNull());
  expect(h.api.connectICloud).toHaveBeenLastCalledWith({
    email: "alex@icloud.com",
    appSpecificPassword: "abcd-efgh",
    mail: true,
    calendar: true,
  });
});
it("requires explicit current consent before requesting an SMS code and retains a rejected verification draft", async () => {
  h.api.startTextingVerification.mockResolvedValue({
    id: "challenge",
    maskedPhoneNumber: "***0123",
    status: "pending",
    expiresAt: new Date(Date.now() + 60000).toISOString(),
  });
  h.api.checkTextingVerification.mockRejectedValue(new Error("Incorrect code"));
  render(<TextingSettingsScreen />);
  fireEvent.change(screen.getByLabelText("Mobile number"), { target: { value: "5555550123" } });
  expect((screen.getByText("Send verification code") as HTMLButtonElement).disabled).toBe(true);
  expect(h.api.startTextingVerification).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("Allow agent text messages"));
  fireEvent.click(screen.getByText("Send verification code"));
  await waitFor(() => expect(screen.getByLabelText("Verification code")).toBeTruthy());
  expect(h.api.startTextingVerification).toHaveBeenCalledWith({
    country: "US",
    phoneNumber: "5555550123",
    consentAccepted: true,
    consentVersion: "2026-10-07-v2",
  });
  fireEvent.change(screen.getByLabelText("Verification code"), { target: { value: "123456" } });
  fireEvent.click(screen.getByText("Verify and connect"));
  await waitFor(() => expect(h.error).toHaveBeenCalledWith("Incorrect code"));
  expect((screen.getByLabelText("Verification code") as HTMLInputElement).value).toBe("123456");
  expect(screen.queryByText("Incorrect code")).toBeNull();
});
it("saves notification policy with the observed revision and rejects invalid quiet hours through Sonner", async () => {
  h.api.saveNotificationPreferences.mockRejectedValue(new Error("Changed elsewhere"));
  render(<NotificationsSettingsScreen />);
  expect(screen.getByText("Native notification controls")).toBeTruthy();
  fireEvent.change(screen.getAllByLabelText("Quiet hours start")[0], { target: { value: "480" } });
  fireEvent.click(screen.getByText("Save global text policy"));
  expect(h.error).toHaveBeenCalledWith("Quiet hours must have distinct start and end times.");
  expect(h.api.saveNotificationPreferences).not.toHaveBeenCalled();
  fireEvent.change(screen.getAllByLabelText("Quiet hours start")[0], { target: { value: "1300" } });
  fireEvent.click(screen.getByText("Save global text policy"));
  await waitFor(() =>
    expect(h.api.saveNotificationPreferences).toHaveBeenCalledWith("global", {
      expectedRevision: 4,
      preferences: { ...preferences, quietStartMinute: 1300 },
    }),
  );
  expect((screen.getAllByLabelText("Quiet hours start")[0] as HTMLInputElement).value).toBe("1300");
});

it("guards native iCloud dismissal with the same dirty confirmation and pending lock as header close", () => {
  const { rerender } = render(<ConnectionsSettingsScreen />);
  fireEvent.click(screen.getByText("Connect iCloud"));
  fireEvent.change(screen.getByLabelText("Apple Account"), {
    target: { value: "alex@icloud.com" },
  });
  act(() => h.modalDismiss?.());
  expect(h.confirm).toHaveBeenCalledWith(
    "Discard iCloud setup?",
    "Your unsaved credentials will be cleared.",
  );
  expect(screen.getByLabelText("Apple Account")).toBeTruthy();
  expect(h.allowSwipeDismissal).toBe(false);
  h.confirm.mockClear();
  h.pending = true;
  rerender(<ConnectionsSettingsScreen />);
  act(() => h.modalDismiss?.());
  expect(h.confirm).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Apple Account")).toBeTruthy();
  h.pending = false;
  rerender(<ConnectionsSettingsScreen />);
  act(() => h.modalDismiss?.());
  act(() => h.confirmation?.());
  expect(screen.queryByLabelText("Apple Account")).toBeNull();
});
it("reloads and reviews a conflicted text policy without losing edits or silently retrying", async () => {
  h.api.saveNotificationPreferences.mockRejectedValueOnce(new Error("Conflict")).mockResolvedValue({
    revision: 8,
    preferences: { ...preferences, enabled: false, quietStartMinute: 1300 },
  });
  h.api.getNotificationStatus.mockResolvedValue({
    preferences: [
      { scope: "global", revision: 7, preferences: { ...preferences, enabled: false } },
    ],
  });
  render(<NotificationsSettingsScreen />);
  fireEvent.change(screen.getAllByLabelText("Quiet hours start")[0], { target: { value: "1300" } });
  fireEvent.click(screen.getByText("Save global text policy"));
  await waitFor(() =>
    expect(screen.getByText("Load latest global policy for review")).toBeTruthy(),
  );
  expect((screen.getByText("Save global text policy") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByText("Load latest global policy for review"));
  await waitFor(() =>
    expect(h.confirm).toHaveBeenCalledWith(
      "Review latest policy",
      expect.stringContaining("Your retained edits"),
    ),
  );
  expect(h.api.saveNotificationPreferences).toHaveBeenCalledTimes(1);
  act(() => h.confirmation?.());
  expect((screen.getAllByLabelText("Quiet hours start")[0] as HTMLInputElement).value).toBe("1300");
  fireEvent.click(screen.getByText("Save global text policy"));
  await waitFor(() =>
    expect(h.api.saveNotificationPreferences).toHaveBeenLastCalledWith("global", {
      expectedRevision: 7,
      preferences: { ...preferences, enabled: false, quietStartMinute: 1300 },
    }),
  );
});
it("reconciles an uncertain policy response already committed without duplicating the write", async () => {
  h.api.saveNotificationPreferences.mockRejectedValueOnce(new Error("Uncertain"));
  h.api.getNotificationStatus.mockResolvedValue({
    preferences: [
      { scope: "global", revision: 5, preferences: { ...preferences, quietStartMinute: 1300 } },
    ],
  });
  render(<NotificationsSettingsScreen />);
  fireEvent.change(screen.getAllByLabelText("Quiet hours start")[0], { target: { value: "1300" } });
  fireEvent.click(screen.getByText("Save global text policy"));
  await waitFor(() =>
    expect(screen.getByText("Load latest global policy for review")).toBeTruthy(),
  );
  fireEvent.click(screen.getByText("Load latest global policy for review"));
  await waitFor(() => expect(h.confirmation).toBeTruthy());
  act(() => h.confirmation?.());
  expect((screen.getByText("Save global text policy") as HTMLButtonElement).disabled).toBe(true);
  expect(h.api.saveNotificationPreferences).toHaveBeenCalledTimes(1);
});

it("opens a dedicated account page without expanding the row or performing a provider action", () => {
  h.resources.connectors = [
    {
      id: "account",
      label: "Work Google",
      email: "alex@example.com",
      provider: "google",
      health: { state: "ready", message: null },
      mailEnabled: true,
      calendarEnabled: true,
      lastSyncedAt: null,
      capabilities: {},
      syncStatus: "idle",
    },
  ];
  const list = render(<ConnectionsSettingsScreen />);
  expect(screen.getByText("Connected")).toBeVisible();
  expect(screen.queryByText("Sync now")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Account Work Google, alex@example.com" }));
  expect(h.navigate).toHaveBeenCalledWith({
    pathname: "/settings/connections/account",
    params: { id: "account" },
  });
  expect(screen.queryByText("Sync now")).toBeNull();
  list.unmount();
  render(<ConnectionAccountScreen />);
  expect(screen.getByText("Sync now")).toBeVisible();
  expect(screen.getByText("Disconnect account")).toBeVisible();
  expect(screen.queryByText("Connect Google in browser")).toBeNull();
  expect(h.api.syncConnector).not.toHaveBeenCalled();
});
