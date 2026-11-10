// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AboutSettingsScreen } from "./about";
import { ActivitySettingsScreen } from "./activity";
import { AppearanceSettingsScreen } from "./appearance";
import { ProfileSettingsScreen } from "./profile";
import { SecuritySettingsScreen } from "./security";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
const h = vi.hoisted(() => ({
  user: {
    id: "one",
    displayName: "Alex Morgan",
    email: "alex@example.com",
    emailVerified: true,
    theme: "system",
    planningTimezone: "UTC",
    homeLocation: null,
    workdayStartMinute: 540,
    workdayEndMinute: 1020,
    setup: { selectedWorkspaces: ["tasks"] },
    canManageInvitations: false,
  },
  save: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  run: vi.fn(),
  resource: vi.fn(),
  refetch: vi.fn(),
  data: [] as unknown[],
}));
vi.mock("../auth/context", () => ({
  useAuth: () => ({ state: { user: h.user }, session: { revalidate: vi.fn(), epoch: () => 1 } }),
}));
vi.mock("./data", () => ({
  useUserSettings: () => ({ user: h.user, save: h.save, pending: false }),
  useSettingsAction: () => ({ pending: false, run: h.run }),
  useSettingsResource: (key: string, _load: unknown, enabled = true) => {
    h.resource(key, enabled);
    return { data: key === "activity" ? h.data : [], isPending: false, refetch: h.refetch };
  },
}));
vi.mock("react-native", () => ({
  View: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Text: ({ children }: PropsWithChildren) => <span>{children}</span>,
  Pressable: ({ children, onPress }: PropsWithChildren<{ onPress: () => void }>) => (
    <button type="button" onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock("expo-router", () => ({ router: { back: vi.fn() }, Stack: { Screen: () => null } }));
vi.mock("../../components/editor-header", () => ({ editorDismissOptions: () => ({}) }));
vi.mock("../../components/forms/form-save", () => ({
  FormSave: ({ onPress, disabled }: { onPress: () => void; disabled: boolean }) => (
    <button type="button" disabled={disabled} onClick={onPress}>
      Save changes
    </button>
  ),
}));
vi.mock("../tasks/data", () => ({ errorMessage: (error: Error) => error.message }));
vi.mock("../../theme", () => ({ useTheme: () => ({}) }));
vi.mock("sonner-native", () => ({ toast: { error: h.error, success: h.success } }));
vi.mock("expo-constants", () => ({
  default: { nativeAppVersion: "2.4.1", nativeBuildVersion: "81" },
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
vi.mock("./profile-location", () => ({ ProfileLocation: () => null }));
vi.mock("../tasks/searchable-choice", () => ({ SearchableChoice: () => null }));
vi.mock("../tasks/ui", () => ({
  FormBody: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Section: ({ children, title }: PropsWithChildren<{ title?: string }>) => (
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
  }) => <input aria-label={label} value={value} onChange={(e) => onChangeText(e.target.value)} />,
  SearchField: ({
    accessibilityLabel,
    value,
    onChangeText,
  }: {
    accessibilityLabel: string;
    value: string;
    onChangeText: (value: string) => void;
  }) => (
    <input
      aria-label={accessibilityLabel}
      value={value}
      onChange={(e) => onChangeText(e.target.value)}
    />
  ),
  Choice: ({
    label,
    value,
    onChange,
    options,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    options: { value: string; label: string }[];
  }) => (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  ToggleRow: () => null,
  Action: ({ label, onPress }: { label: string; onPress: () => void }) => (
    <button type="button" onClick={onPress}>
      {label}
    </button>
  ),
  State: () => null,
  confirm: vi.fn(),
  styles: { settingRow: {} },
}));
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  h.data = [];
  h.user.canManageInvitations = false;
  h.save.mockResolvedValue({ ok: false });
  h.refetch.mockResolvedValue({});
  h.run.mockImplementation(async (operation, success) => {
    try {
      const value = await operation({});
      if (success) h.success(typeof success === "function" ? success(value) : success);
      return { ok: true, value };
    } catch (error) {
      h.error((error as Error).message);
      return { ok: false };
    }
  });
});
it("saves only changed identity fields and leaves rejected drafts visible", async () => {
  render(<ProfileSettingsScreen />);
  fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Jamie" } });
  fireEvent.click(screen.getByText("Save changes"));
  await waitFor(() =>
    expect(h.save).toHaveBeenCalledWith({ displayName: "Jamie Morgan" }, "Profile updated"),
  );
  expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe("Jamie");
  expect(h.success).not.toHaveBeenCalled();
});
it("retains an invalid schedule and sends its failure through Sonner", () => {
  render(<ProfileSettingsScreen />);
  fireEvent.change(screen.getByLabelText("Day starts"), { target: { value: "1100" } });
  fireEvent.click(screen.getByText("Save changes"));
  expect(h.error).toHaveBeenCalledWith("Day end must be after day start.");
  expect(h.save).not.toHaveBeenCalled();
  expect(screen.queryByText("Day end must be after day start.")).toBeNull();
  expect((screen.getByLabelText("Day starts") as HTMLInputElement).value).toBe("1100");
});
it("persists shared appearance choices", () => {
  render(<AppearanceSettingsScreen />);
  fireEvent.change(screen.getByLabelText("Theme"), { target: { value: "dark" } });
  expect(h.save).toHaveBeenCalledWith({ theme: "dark" });
});
it("shows an honest bounded audit history without exposing before/after content", () => {
  h.data = [
    {
      id: "event",
      action: "update_task",
      entityType: "task",
      entityId: "record",
      actorType: "human",
      createdAt: "2026-11-10T12:00:00Z",
      requestId: "request",
      before: { secret: "private" },
      after: { password: "secret" },
    },
  ];
  render(<ActivitySettingsScreen />);
  expect(screen.getByText(/Latest 100 events/)).toBeTruthy();
  fireEvent.click(screen.getByText("update task"));
  expect(screen.getByText("Request: request")).toBeTruthy();
  expect(screen.queryByText(/private|password|secret/)).toBeNull();
  fireEvent.change(screen.getByLabelText("Search activity"), { target: { value: "calendar" } });
  expect(screen.queryByText("update task")).toBeNull();
});
it("omits owner invitation controls for other users", () => {
  render(<SecuritySettingsScreen />);
  expect(screen.queryByText("Create invitation")).toBeNull();
  expect(h.resource).toHaveBeenCalledWith("invitations", false);
});
it("shows installed build metadata", () => {
  render(<AboutSettingsScreen />);
  expect(screen.getByText("2.4.1")).toBeTruthy();
  expect(screen.getByText("81")).toBeTruthy();
});

it("renders Profile on Hermes without Intl.supportedValuesOf", () => {
  const descriptor = Object.getOwnPropertyDescriptor(Intl, "supportedValuesOf");
  Object.defineProperty(Intl, "supportedValuesOf", { configurable: true, value: undefined });
  try {
    render(<ProfileSettingsScreen />);
    expect(screen.getByLabelText("First name")).toBeTruthy();
  } finally {
    if (descriptor) Object.defineProperty(Intl, "supportedValuesOf", descriptor);
  }
});

it("refreshes cached Activity with explicit success/error feedback and retains cached events on failure", async () => {
  h.data = [
    {
      id: "event",
      action: "update_task",
      entityType: "task",
      entityId: "record",
      actorType: "human",
      createdAt: "2026-11-10T12:00:00Z",
      requestId: "request",
    },
  ];
  render(<ActivitySettingsScreen />);
  fireEvent.click(screen.getByText("Refresh activity"));
  await waitFor(() => expect(h.success).toHaveBeenCalledWith("Activity refreshed"));
  h.refetch.mockResolvedValueOnce({ error: new Error("Refresh denied") });
  fireEvent.click(screen.getByText("Refresh activity"));
  await waitFor(() => expect(h.error).toHaveBeenCalledWith("Refresh denied"));
  expect(screen.getByText("update task")).toBeTruthy();
  expect(screen.queryByText("Refresh denied")).toBeNull();
});
