// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MobileDataProvider } from "../tasks/data";
import { SecuritySettingsScreen } from "./security";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("@tanstack/react-query", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/apps/web/package.json`)("@tanstack/react-query");
});
const h = vi.hoisted(() => ({
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
      user: { id: "security-fixture", email: "fixture@nohmi.test", canManageInvitations: h.owner },
    },
    session: { epoch: () => h.epoch, api: () => h.api, logout: h.logout, revalidate: h.revalidate },
  }),
}));
vi.mock("sonner-native", () => ({
  toast: { error: h.error, loading: h.loading, success: h.success, dismiss: h.dismiss },
}));
vi.mock("../../theme", () => ({ useTheme: () => ({}) }));
vi.mock("react-native", () => ({
  Text: ({ children }: PropsWithChildren) => <span>{children}</span>,
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
afterEach(cleanup);
const show = () =>
  render(
    <MobileDataProvider>
      <SecuritySettingsScreen />
    </MobileDataProvider>,
  );
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
  show();
  await screen.findByText("Unknown device");
  expect(screen.getByText("IP address unavailable")).toBeTruthy();
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
  show();
  await screen.findByText("No invitations yet.");
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
  const mounted = show();
  await screen.findByText("No invitations yet.");
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
