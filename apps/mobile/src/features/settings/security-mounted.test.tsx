// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MobileDataProvider } from "../tasks/data";
import {
  SecurityDeviceScreen,
  SecurityInvitationCreateScreen,
  SecurityInvitationsScreen,
  SecuritySettingsScreen,
  sessionDeviceName,
  sessionLastActive,
} from "./security";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("@tanstack/react-query", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/apps/web/package.json`)("@tanstack/react-query");
});
const h = vi.hoisted(() => ({
  params: { id: "fixture-session" },
  push: vi.fn(),
  signedIn: true,
  fontScale: 1,
  owner: true,
  epoch: 1,
  api: {} as Record<string, unknown>,
  sessions: vi.fn(),
  invitations: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
  reset: vi.fn(),
  logout: vi.fn(),
  revalidate: vi.fn(),
  confirm: vi.fn(),
  error: vi.fn(),
  loading: vi.fn(() => "security-toast"),
  success: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("../auth/context", () => ({
  useAuth: () => ({
    state: {
      user: h.signedIn
        ? { id: "security-fixture", email: "fixture@nohmi.test", canManageInvitations: h.owner }
        : null,
    },
    session: { epoch: () => h.epoch, api: () => h.api, logout: h.logout, revalidate: h.revalidate },
  }),
}));
vi.mock("sonner-native", () => ({
  toast: { error: h.error, loading: h.loading, success: h.success, dismiss: h.dismiss },
}));
vi.mock("../../theme", () => ({
  useTheme: () => ({}),
  spacing: { xs: 4, sm: 8, md: 12, lg: 16 },
}));
vi.mock("../../components/forms/use-dirty-dismiss", () => ({ useDirtyDismiss: () => {} }));
vi.mock("expo-router", () => ({
  router: { push: h.push },
  useLocalSearchParams: () => h.params,
  Stack: { Screen: () => null },
}));
vi.mock("../../components/icons", () => ({ Icon: () => null }));
vi.mock("./settings-row", () => ({
  SettingsRow: ({
    label,
    value,
    onPress,
  }: {
    label: string;
    value?: string;
    onPress: () => void;
  }) => (
    <button type="button" onClick={onPress}>
      {label}
      {value}
    </button>
  ),
  SettingsActionRow: ({
    label,
    disabled,
    destructive,
    onPress,
  }: {
    label: string;
    disabled?: boolean;
    destructive?: boolean;
    onPress: () => void;
  }) => (
    <button type="button" disabled={disabled} data-destructive={destructive} onClick={onPress}>
      {label}
    </button>
  ),
  SettingsIdentity: ({ name, detail }: { name: string; detail?: string }) => (
    <div data-testid="device-identity">
      <h2>{name}</h2>
      <p>{detail}</p>
    </div>
  ),
  SettingsDetailRow: ({ label, value }: { label: string; value: string }) => (
    <div>
      {label}
      {value}
    </div>
  ),
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios", isPad: false },
  useWindowDimensions: () => ({ width: 390, height: 844, fontScale: h.fontScale }),
  Pressable: ({
    children,
    onPress,
    accessibilityLabel,
  }: PropsWithChildren<{ onPress: () => void; accessibilityLabel?: string }>) => (
    <button type="button" aria-label={accessibilityLabel} onClick={onPress}>
      {children}
    </button>
  ),
  Text: ({ children, numberOfLines }: PropsWithChildren<{ numberOfLines?: number }>) => (
    <span data-lines={numberOfLines}>{children}</span>
  ),
  View: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("../tasks/ui", () => ({
  FormBody: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Section: ({ title, children }: PropsWithChildren<{ title: string }>) => (
    <section aria-label={title}>{children}</section>
  ),
  Field: ({
    label,
    value,
    onChangeText,
  }: {
    label: string;
    value: string;
    onChangeText: (value: string) => void;
  }) => (
    <input
      aria-label={label}
      value={value}
      onChange={(event) => onChangeText(event.target.value)}
    />
  ),
  Action: ({
    label,
    disabled,
    onPress,
  }: {
    label: string;
    disabled: boolean;
    onPress: () => void;
  }) => (
    <button type="button" disabled={disabled} onClick={onPress}>
      {label}
    </button>
  ),
  State: ({ loading, retry, empty }: { loading?: boolean; retry?: () => void; empty?: string }) => (
    <div>
      {loading
        ? "Loading"
        : (empty ?? (
            <button type="button" onClick={retry}>
              Retry
            </button>
          ))}
    </div>
  ),
  styles: { settingRow: {} },
  confirm: h.confirm,
}));
beforeEach(() => {
  vi.clearAllMocks();
  h.signedIn = true;
  h.fontScale = 1;
  h.owner = true;
  h.epoch = 1;
  h.sessions.mockReset().mockResolvedValue([]);
  h.invitations.mockReset().mockResolvedValue([]);
  h.create.mockReset().mockResolvedValue({ code: "synthetic-invite" });
  h.revoke.mockReset().mockResolvedValue(undefined);
  h.reset.mockReset().mockResolvedValue(undefined);
  h.logout.mockReset().mockResolvedValue(undefined);
  h.revalidate.mockReset().mockResolvedValue(undefined);
  h.api = {
    listSessions: h.sessions,
    listInvitations: h.invitations,
    createInvitation: h.create,
    revokeSession: h.revoke,
    requestPasswordReset: h.reset,
  };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const NOW = "2026-11-14T12:00:00Z";
const freezeClock = () => vi.useFakeTimers({ toFake: ["Date"], now: new Date(NOW) });
const NOHMI_APP = "nohmi/10 CFNetwork/3896.100.1.2.1 Darwin/27.0.0";
const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
const device = (id: string, userAgent: string | null, lastSeenAt: string, isCurrent = false) => ({
  id,
  userAgent,
  ipAddress: null,
  createdAt: "2026-10-01T12:00:00Z",
  lastSeenAt,
  expiresAt: "2026-12-01T12:00:00Z",
  isCurrent,
});
const rows = (section: string) =>
  within(screen.getByRole("region", { name: section }))
    .getAllByRole("button")
    .map((row) => row.getAttribute("aria-label"));
const show = (children: React.ReactNode = <SecuritySettingsScreen />) =>
  render(<MobileDataProvider>{children}</MobileDataProvider>);
const confirmLast = async () => {
  const callback = h.confirm.mock.calls.at(-1)?.[2] as () => void;
  await act(async () => callback());
};

it("requires confirmation before reset or sign out, and reports confirmed reset through one toast", async () => {
  show();
  await screen.findByText("No active sessions returned.");
  fireEvent.click(screen.getByRole("button", { name: "Send password reset email" }));
  expect(h.reset).not.toHaveBeenCalled();
  expect(h.confirm).toHaveBeenLastCalledWith(
    "Reset password?",
    "Send a reset email to fixture@nohmi.test?",
    expect.any(Function),
  );
  await confirmLast();
  expect(h.reset).toHaveBeenCalledWith({ email: "fixture@nohmi.test" });
  expect(h.success).toHaveBeenCalledWith("Password reset email requested", {
    id: "security-toast",
  });
  expect(screen.queryByText("Password reset email requested")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  expect(h.logout).not.toHaveBeenCalled();
  await confirmLast();
  expect(h.logout).toHaveBeenCalledOnce();
});

it("revokes only the confirmed synthetic session and revalidates identity before refreshing devices", async () => {
  h.sessions.mockResolvedValue([
    {
      id: "fixture-session",
      userAgent: null,
      ipAddress: null,
      createdAt: "2026-11-01T12:00:00Z",
      lastSeenAt: "2026-11-10T12:00:00Z",
      expiresAt: "2026-12-01T12:00:00Z",
    },
  ]);
  show(<SecurityDeviceScreen />);
  await screen.findAllByText("Unknown device");
  expect(screen.getByText(/IP address unavailable/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Revoke session" }));
  expect(h.revoke).not.toHaveBeenCalled();
  expect(h.confirm.mock.calls.at(-1)?.[1]).toContain("This may be your current session");
  await confirmLast();
  expect(h.revoke).toHaveBeenCalledWith("fixture-session");
  expect(h.revalidate).toHaveBeenCalledOnce();
  expect(h.sessions).toHaveBeenCalledTimes(2);
  expect(h.success).toHaveBeenCalledWith("Session revoked", { id: "security-toast" });
});

it("retains invitation corrections on validation and denied creation, then displays only the returned code", async () => {
  show(<SecurityInvitationCreateScreen />);
  await screen.findByLabelText("Recipient");
  const email = screen.getByLabelText("Recipient");
  const expiry = screen.getByLabelText("Expires after days");
  fireEvent.change(email, { target: { value: "recipient@nohmi.test" } });
  fireEvent.change(expiry, { target: { value: "91" } });
  fireEvent.click(screen.getByRole("button", { name: "Create invitation" }));
  expect(h.create).not.toHaveBeenCalled();
  expect(h.error).toHaveBeenCalledOnce();
  expect(screen.queryByText(String(h.error.mock.calls[0]?.[0]))).toBeNull();
  fireEvent.change(expiry, { target: { value: "1" } });
  h.create.mockRejectedValueOnce(new Error("Invitation denied"));
  fireEvent.click(screen.getByRole("button", { name: "Create invitation" }));
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(expect.any(String), { id: "security-toast" }),
  );
  expect(email).toHaveValue("recipient@nohmi.test");
  expect(expiry).toHaveValue("1");
  expect(screen.queryByText("Invitation denied")).toBeNull();
  expect(screen.queryByText("Invitation code")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Create invitation" }));
  await screen.findByText("synthetic-invite");
  expect(h.create).toHaveBeenLastCalledWith({ email: "recipient@nohmi.test", expiresInDays: 1 });
  expect(h.invitations).toHaveBeenCalledTimes(2);
});

it("omits invitation reads and controls without owner authority, and clears returned codes on a new auth epoch", async () => {
  const mounted = show(<SecurityInvitationCreateScreen />);
  await screen.findByLabelText("Recipient");
  fireEvent.click(screen.getByRole("button", { name: "Create invitation" }));
  await screen.findByText("synthetic-invite");
  expect(h.create).toHaveBeenCalledWith({ expiresInDays: 14 });
  await waitFor(() => expect(h.invitations).toHaveBeenCalledTimes(2));
  h.owner = false;
  h.epoch = 2;
  mounted.rerender(
    <MobileDataProvider>
      <SecuritySettingsScreen />
    </MobileDataProvider>,
  );
  await screen.findByText("No active sessions returned.");
  expect(screen.queryByText("synthetic-invite")).toBeNull();
  expect(screen.queryByRole("button", { name: "Create invitation" })).toBeNull();
  expect(h.invitations).toHaveBeenCalledTimes(2);
});

it("distinguishes read failure from an empty device list and retries through the real query cache", async () => {
  h.owner = false;
  h.sessions.mockRejectedValueOnce(new Error("Devices offline")).mockResolvedValue([]);
  show();
  await screen.findByRole("button", { name: "Retry" });
  expect(screen.queryByText("No active sessions returned.")).toBeNull();
  expect(h.error).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("No active sessions returned.");
  expect(h.invitations).not.toHaveBeenCalled();
});

it("navigates owner invitation list and create child without creating any record", async () => {
  const view = show();
  await screen.findByText("No active sessions returned.");
  fireEvent.click(screen.getByRole("button", { name: "Invitations" }));
  expect(h.push).toHaveBeenCalledWith("/settings/security/invitations");
  expect(h.invitations).not.toHaveBeenCalled();
  view.rerender(
    <MobileDataProvider>
      <SecurityInvitationsScreen />
    </MobileDataProvider>,
  );
  await screen.findByText("No invitations yet.");
  fireEvent.click(screen.getByRole("button", { name: "Create invitation" }));
  expect(h.push).toHaveBeenCalledWith("/settings/security/create-invitation");
  expect(h.create).not.toHaveBeenCalled();
});
it("keeps technical session metadata in its native child and retries a denied device read", async () => {
  h.sessions.mockRejectedValueOnce(new Error("Device read denied")).mockResolvedValue([
    {
      id: "fixture-session",
      userAgent: "Mozilla/5.0 (iPhone) Safari/604.1",
      ipAddress: "192.0.2.5",
      createdAt: "2026-11-01",
      lastSeenAt: "2026-11-10",
      expiresAt: "2026-12-01",
    },
  ]);
  const view = show();
  await screen.findByRole("button", { name: "Retry" });
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByRole("button", { name: /Safari on iPhone/ });
  expect(screen.queryByText(/192.0.2.5/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Safari on iPhone/ }));
  expect(h.push).toHaveBeenCalledWith({
    pathname: "/settings/security/device",
    params: { id: "fixture-session" },
  });
  view.rerender(
    <MobileDataProvider>
      <SecurityDeviceScreen />
    </MobileDataProvider>,
  );
  await screen.findByText(/192.0.2.5/);
  expect(h.revoke).not.toHaveBeenCalled();
});

it.each([
  true,
  false,
  undefined,
])("badges current device only with authoritative isCurrent=%s", async (isCurrent) => {
  h.sessions.mockResolvedValue([
    {
      id: "fixture-session",
      userAgent: "Mozilla/5.0 (iPhone) Safari/604.1",
      ipAddress: "192.0.2.5",
      createdAt: "2026-11-01",
      lastSeenAt: "2026-11-10",
      expiresAt: "2026-12-01",
      ...(isCurrent === undefined ? {} : { isCurrent }),
    },
  ]);
  const view = show();
  await screen.findByRole("button", { name: /Safari on iPhone/ });
  expect(screen.queryByText(/This iPhone/) !== null).toBe(isCurrent === true);
  view.rerender(
    <MobileDataProvider>
      <SecurityDeviceScreen />
    </MobileDataProvider>,
  );
  await screen.findByRole("button", { name: "Revoke session" });
  expect(screen.queryByText(/This iPhone/) !== null).toBe(isCurrent === true);
  fireEvent.click(screen.getByRole("button", { name: "Revoke session" }));
  expect(h.confirm.mock.calls.at(-1)?.[1]).toContain(
    isCurrent === true ? "This is your current session" : "This may be your current session",
  );
  expect(h.revoke).not.toHaveBeenCalled();
});

it.each([
  ["Mozilla/5.0 Edg/130 Windows", "Edge on Windows"],
  ["Chrome/130 Android", "Chrome on Android"],
  ["Firefox/130 Linux", "Firefox on Linux"],
  ["Safari/604 Macintosh", "Safari on Mac"],
  ["Safari/604 iPad", "Safari on iPad"],
  ["iPhone native client", "iPhone"],
  [NOHMI_APP, "nohmi app"],
  ["curl/8.7.1", "curl"],
  ["Mozilla/5.0 (compatible)", "Unknown device"],
  ["unrecognized client", "Unknown device"],
] as const)("summarizes actual user agent %s without exposing technical text on the device list", (ua, summary) => {
  expect(sessionDeviceName(ua)).toBe(summary);
});
it.each([
  SecuritySettingsScreen,
  SecurityDeviceScreen,
  SecurityInvitationsScreen,
  SecurityInvitationCreateScreen,
])("does not read security data after sign-out", (Page) => {
  h.signedIn = false;
  show(<Page />);
  expect(h.sessions).not.toHaveBeenCalled();
  expect(h.invitations).not.toHaveBeenCalled();
  expect(screen.queryByText("Sign out")).toBeNull();
});
it("retries invitation read failure and displays returned redemption/expiry states honestly", async () => {
  h.invitations.mockRejectedValueOnce(new Error("Invitations offline")).mockResolvedValueOnce([
    {
      id: "redeemed",
      email: "redeemed@nohmi.test",
      redeemedAt: "2026-11-01",
      expiresAt: "2099-12-31",
    },
    { id: "expired", email: null, redeemedAt: null, expiresAt: "2000-01-01" },
    { id: "valid", email: "valid@nohmi.test", redeemedAt: null, expiresAt: "2099-12-31" },
  ]);
  show(<SecurityInvitationsScreen />);
  await screen.findByRole("button", { name: "Retry" });
  expect(h.error).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("Redeemed");
  expect(screen.getByText("Expired")).toBeTruthy();
  expect(screen.getByText("Any recipient")).toBeTruthy();
  expect(screen.getByText(/Expires /)).toBeTruthy();
  expect(h.invitations).toHaveBeenCalledTimes(2);
  expect(h.create).not.toHaveBeenCalled();
});
it("handles a selected session removed elsewhere without offering revocation", async () => {
  h.sessions.mockResolvedValue([
    {
      id: "other",
      userAgent: null,
      ipAddress: null,
      createdAt: "2026-01-01",
      lastSeenAt: "2026-01-01",
      expiresAt: "2099-01-01",
    },
  ]);
  show(<SecurityDeviceScreen />);
  await screen.findByText("This session is no longer active.");
  expect(screen.queryByRole("button", { name: "Revoke session" })).toBeNull();
});
it("retains nonnumeric invitation expiry as a correction draft without transport", async () => {
  show(<SecurityInvitationCreateScreen />);
  await screen.findByLabelText("Expires after days");
  fireEvent.change(screen.getByLabelText("Expires after days"), { target: { value: "tomorrow" } });
  fireEvent.click(screen.getByRole("button", { name: "Create invitation" }));
  expect(h.error).toHaveBeenCalledOnce();
  expect(h.create).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Expires after days")).toHaveValue("tomorrow");
});

it("shows a single signed-in device as this iPhone, with nothing listed under other devices", async () => {
  freezeClock();
  h.sessions.mockResolvedValue([device("fixture-session", NOHMI_APP, NOW, true)]);
  show();
  await screen.findByRole("region", { name: "This device" });
  expect(rows("This device")).toEqual(["This iPhone, nohmi app, Active now"]);
  expect(screen.getByText("This iPhone")).toBeTruthy();
  expect(screen.getByText("nohmi app · Active now")).toBeTruthy();
  const others = screen.getByRole("region", { name: "Other devices" });
  expect(within(others).queryAllByRole("button")).toEqual([]);
  expect(within(others).getByText("No other devices are signed in.")).toBeTruthy();
  expect(screen.queryByText(/Signed-in device/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /This iPhone/ }));
  expect(h.push).toHaveBeenCalledWith({
    pathname: "/settings/security/device",
    params: { id: "fixture-session" },
  });
});

it("names several devices apart, this device first and the rest by most recent activity", async () => {
  freezeClock();
  h.sessions.mockResolvedValue([
    device("old-app", NOHMI_APP, "2026-10-19T12:00:00Z"),
    device("browser", CHROME_MAC, "2026-11-14T09:00:00Z"),
    device("fixture-session", NOHMI_APP, NOW, true),
    device("unknown", null, "2026-11-12T12:00:00Z"),
  ]);
  show();
  await screen.findByRole("region", { name: "Other devices" });
  expect(rows("This device")).toEqual(["This iPhone, nohmi app, Active now"]);
  const others = rows("Other devices");
  expect(others).toHaveLength(3);
  expect(others[0]).toBe("Chrome on Mac, Active 3 hours ago");
  expect(others[1]).toBe("Unknown device, Active 2 days ago");
  expect(others[2]).toMatch(/^nohmi app, Last active .*2026$/);
  expect(screen.queryByText("No other devices are signed in.")).toBeNull();
  expect(screen.queryByText(/Signed-in device/)).toBeNull();
  expect(screen.getAllByText(/This iPhone/)).toHaveLength(1);
});

it("keeps a long device name on one line above its activity and shows it in full on the device page", async () => {
  freezeClock();
  const name = "PersonalAutomationBridgeForHomeServer-nightly";
  h.sessions.mockResolvedValue([
    device("fixture-session", `${name}/2026.11.3 (linux-arm64)`, "2026-11-13T12:00:00Z"),
  ]);
  const view = show();
  const row = await screen.findByRole("button", { name: `${name}, Active yesterday` });
  const label = within(row).getByText(name);
  const activity = within(row).getByText("Active yesterday");
  expect(label.dataset.lines).toBe("1");
  expect(activity.dataset.lines).toBe("1");
  expect(label).not.toBe(activity);
  expect(label.parentElement).toBe(activity.parentElement);
  view.rerender(
    <MobileDataProvider>
      <SecurityDeviceScreen />
    </MobileDataProvider>,
  );
  const identity = await screen.findByTestId("device-identity");
  expect(within(identity).getByRole("heading").textContent).toBe(name);
  expect(screen.getByText(`${name}/2026.11.3 (linux-arm64)`).dataset.lines).toBeUndefined();
});

it("shows no device sections, counts or empty copy while the device read is pending or failed", async () => {
  let fail: (error: Error) => void = () => {};
  h.sessions.mockReturnValueOnce(
    new Promise((_, reject) => {
      fail = reject;
    }),
  );
  show();
  await screen.findByText("Loading");
  for (const copy of ["This device", "Other devices"])
    expect(screen.queryByRole("region", { name: copy })).toBeNull();
  expect(screen.queryByText("No other devices are signed in.")).toBeNull();
  expect(screen.queryByText("No active sessions returned.")).toBeNull();
  await act(async () => fail(new Error("Devices offline")));
  await screen.findByRole("button", { name: "Retry" });
  expect(screen.queryByRole("region", { name: "Other devices" })).toBeNull();
  expect(screen.queryByText("No other devices are signed in.")).toBeNull();
});

it("keeps sign out a separate confirmed destructive action", async () => {
  show();
  await screen.findByText("No active sessions returned.");
  const signOut = screen.getByRole("button", { name: "Sign out" });
  expect(signOut.dataset.destructive).toBe("true");
  expect(signOut.closest("section")).not.toBe(
    screen.getByRole("button", { name: "Send password reset email" }).closest("section"),
  );
});

it.each([
  ["2026-11-14T11:58:00Z", "Active now"],
  ["2026-11-14T11:20:00Z", "Active 40 minutes ago"],
  ["2026-11-14T10:30:00Z", "Active 1 hour ago"],
  ["2026-11-13T11:00:00Z", "Active yesterday"],
  ["2026-11-09T12:00:00Z", "Active 5 days ago"],
  ["not a date", "Last active time unavailable"],
])("describes last activity at %s as %s", (lastSeenAt, summary) => {
  expect(sessionLastActive(lastSeenAt, new Date(NOW).getTime())).toBe(summary);
});

it("lets a device row take a second line at accessibility text sizes instead of cutting off its recency", async () => {
  freezeClock();
  h.fontScale = 1.3;
  h.sessions.mockResolvedValue([device("fixture-session", CHROME_MAC, "2026-11-01T12:00:00Z")]);
  show();
  const row = await screen.findByRole("button", { name: /^Chrome on Mac, Last active/ });
  expect(within(row).getByText("Chrome on Mac").dataset.lines).toBe("2");
  expect(within(row).getByText(/^Last active/).dataset.lines).toBe("2");
});

it("orders other devices by the instant they were last active, not by timestamp text", async () => {
  freezeClock();
  h.sessions.mockResolvedValue([
    device("offset", "curl/8.7.1", "2026-11-14T10:00:00+02:00"),
    device("utc", CHROME_MAC, "2026-11-14T09:00:00Z"),
    device("unreadable", "Firefox/130 Linux", "not a date"),
  ]);
  show();
  await screen.findByRole("button", { name: /^curl/ });
  expect(rows("Signed-in devices")).toEqual([
    "Chrome on Mac, Active 3 hours ago",
    "curl, Active 4 hours ago",
    "Firefox on Linux, Last active time unavailable",
  ]);
});

it.each([
  [new Date(2026, 10, 13, 0, 30), "Active yesterday"],
  [new Date(2026, 10, 12, 23, 0), "Active 2 days ago"],
  [new Date(2026, 10, 13, 23, 0), "Active 2 hours ago"],
])("counts calendar days, so %s seen from 1am on 14 Nov is %s", (seen, summary) => {
  expect(sessionLastActive(seen.toISOString(), new Date(2026, 10, 14, 1, 0).getTime())).toBe(
    summary,
  );
});
