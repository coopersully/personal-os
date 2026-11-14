// @vitest-environment jsdom
import type { User } from "@personal-os/domain";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MobileDataProvider } from "../tasks/data";
import { ProfileSettingsScreen, setupReplayUrl } from "./profile";
import { ProfileTime } from "./profile-time";
import { ProfileTime as NativeProfileTime } from "./profile-time.ios";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("@tanstack/react-query", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/apps/web/package.json`)("@tanstack/react-query");
});
const h = vi.hoisted(() => ({
  user: {} as User,
  epoch: 1,
  signedIn: true,
  api: {} as Record<string, unknown>,
  accept: vi.fn(),
  update: vi.fn(),
  me: vi.fn(),
  setup: vi.fn(),
  verify: vi.fn(),
  search: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  loading: vi.fn(() => "profile-toast"),
  dismiss: vi.fn(),
  confirm: vi.fn(),
  back: vi.fn(),
  close: undefined as (() => void) | undefined,
  foreground: undefined as ((state: string) => void) | undefined,
  open: vi.fn(),
  context: vi.fn(),
}));
vi.mock("../auth/context", () => {
  const session = { epoch: () => h.epoch, api: () => h.api, acceptUserUpdate: h.accept };
  return {
    useAuth: () => ({ state: { user: h.signedIn ? h.user : null }, session }),
    useOptionalAuth: () => null,
  };
});
vi.mock("sonner-native", () => ({
  toast: { error: h.error, success: h.success, loading: h.loading, dismiss: h.dismiss },
}));
vi.mock("react-native", async () => ({
  ...(await import("../../../test/native")),
  Linking: { openURL: h.open },
  AppState: {
    addEventListener: (_name: string, callback: (state: string) => void) => {
      h.foreground = callback;
      return {
        remove: () => {
          if (h.foreground === callback) h.foreground = undefined;
        },
      };
    },
  },
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("../../theme", () => ({
  useTheme: () => ({}),
  workspaceColor: () => "#7928ff",
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, page: 20, xl: 24, xxl: 32 },
  radius: { sm: 4, md: 6, control: 8, menu: 12, panel: 16 },
  touchTarget: 44,
}));
vi.mock("../../components/icons", () => ({ Icon: () => null }));
vi.mock("expo-router", () => ({ router: { back: h.back }, Stack: { Screen: () => null } }));
vi.mock("../../components/editor-header", () => ({
  editorDismissOptions: ({ onPress }: { onPress: () => void }) => {
    h.close = onPress;
    return {};
  },
}));
vi.mock("../../components/sheet-header", () => ({
  SheetHeader: ({ onClose, label }: { onClose: () => void; label: string }) => (
    <button type="button" onClick={onClose}>
      {label} picker
    </button>
  ),
}));
vi.mock("../../components/forms/form-save", () => ({
  FormSave: ({ onPress, disabled }: { onPress: () => void; disabled: boolean }) => (
    <button type="button" onClick={onPress} disabled={disabled}>
      Save changes
    </button>
  ),
}));
vi.mock("@expo/ui/community/datetime-picker", () => ({
  default: ({ onChange }: { onChange: (event: unknown, date?: Date) => void }) => (
    <div>
      <button type="button" onClick={() => onChange({}, new Date("2000-01-01T00:00:00Z"))}>
        Choose midnight
      </button>
      <button type="button" onClick={() => onChange({}, new Date("2000-01-01T08:45:00Z"))}>
        Choose 8:45
      </button>
      <button type="button" onClick={() => onChange({})}>
        Cancel native selection
      </button>
    </div>
  ),
}));
vi.mock("../tasks/searchable-choice", () => ({
  SearchableChoice: ({
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
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
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
  Section: ({ title, children }: PropsWithChildren<{ title?: string }>) => (
    <section aria-label={title}>{children}</section>
  ),
  Field: ({
    label,
    value,
    onChangeText,
    editable = true,
  }: {
    label: string;
    value: string;
    onChangeText: (value: string) => void;
    editable?: boolean;
  }) => (
    <input
      aria-label={label}
      value={value}
      disabled={!editable}
      onChange={(event) => onChangeText(event.target.value)}
    />
  ),
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
      onChange={(event) => onChangeText(event.target.value)}
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
    <input
      type="checkbox"
      aria-label={label}
      checked={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
    />
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
      <span>Loading</span>
    ) : retry ? (
      <button type="button" onClick={retry}>
        Retry locations
      </button>
    ) : (
      <span>{empty}</span>
    ),
  confirm: h.confirm,
  styles: { settingRow: {} },
}));
const initial = () =>
  ({
    id: "profile-fixture",
    displayName: "Alex Morgan",
    email: "alex@nohmi.test",
    theme: "system",
    emailVerified: false,
    planningTimezone: "UTC",
    homeLocation: null,
    workdayStartMinute: 540,
    workdayEndMinute: 1020,
    setup: { selectedWorkspaces: ["tasks"], status: "complete" },
    canManageInvitations: false,
  }) as User;
beforeEach(() => {
  vi.clearAllMocks();
  h.epoch = 1;
  h.signedIn = true;
  h.user = initial();
  h.close = undefined;
  h.foreground = undefined;
  h.open.mockReset().mockResolvedValue(undefined);
  h.context.mockReset().mockResolvedValue({ links: { today: "https://fixture.example/today" } });
  h.accept.mockImplementation((user: User) => {
    h.user = user;
    return true;
  });
  h.update.mockReset().mockImplementation(async (input) => ({ ...h.user, ...input }));
  h.me.mockReset().mockImplementation(async () => h.user);
  h.setup.mockReset().mockImplementation(async (input) => ({
    ...h.user,
    setup: { ...h.user.setup, selectedWorkspaces: input.selectedWorkspaces },
  }));
  h.verify.mockReset().mockResolvedValue(undefined);
  h.search.mockReset().mockResolvedValue([]);
  h.api = {
    updateUser: h.update,
    getMe: h.me,
    updateAccountSetup: h.setup,
    resendEmailVerification: h.verify,
    searchWeatherLocations: h.search,
    getPersonalOsContext: h.context,
  };
});
afterEach(cleanup);
const show = () =>
  render(
    <MobileDataProvider>
      <ProfileSettingsScreen />
    </MobileDataProvider>,
  );
it("persists the minimal Profile patch through real settings/auth hooks and resets the saved baseline", async () => {
  show();
  expect((screen.getByText("Save changes") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Jamie" } });
  fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Rivera" } });
  fireEvent.click(screen.getByText("Save changes"));
  await waitFor(() => expect(h.update).toHaveBeenCalledWith({ displayName: "Jamie Rivera" }));
  await waitFor(() =>
    expect(h.accept).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "Jamie Rivera" }),
      1,
    ),
  );
  expect(h.loading).toHaveBeenCalledTimes(1);
  expect(h.success).toHaveBeenCalledWith("Profile updated", { id: "profile-toast" });
  expect((screen.getByText("Save changes") as HTMLButtonElement).disabled).toBe(true);
  expect(h.me).not.toHaveBeenCalled();
});
it("confirms draft discard, validates email, and retains an invalid email without network or inline error", () => {
  show();
  act(() => h.close?.());
  expect(h.back).toHaveBeenCalledOnce();
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "invalid" } });
  expect((screen.getByText("Send verification email") as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByText("Save changes"));
  expect(h.error).toHaveBeenCalled();
  expect(h.update).not.toHaveBeenCalled();
  expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("invalid");
  act(() => h.close?.());
  expect(h.confirm).toHaveBeenCalledWith(
    "Discard changes?",
    expect.any(String),
    expect.any(Function),
  );
  expect(h.back).toHaveBeenCalledOnce();
  act(() => h.confirm.mock.calls.at(-1)?.[2]());
  expect(h.back).toHaveBeenCalledTimes(2);
});
it("requests verification explicitly and updates only the selected setup workspace from latest server state", async () => {
  show();
  expect(h.verify).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Send verification email"));
  await waitFor(() => expect(h.verify).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("Verification email requested", { id: "profile-toast" }),
  );
  h.success.mockClear();
  h.me.mockResolvedValueOnce({
    ...h.user,
    setup: { ...h.user.setup, selectedWorkspaces: ["tasks", "finances"] },
  });
  fireEvent.click(screen.getByLabelText("Mail"));
  await waitFor(() =>
    expect(h.setup).toHaveBeenCalledWith({
      action: "preferences",
      selectedWorkspaces: ["tasks", "finances", "mail"],
    }),
  );
  await waitFor(() => expect(h.accept).toHaveBeenCalled());
  expect(h.success).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("Tasks"));
  await waitFor(() =>
    expect(h.setup).toHaveBeenLastCalledWith({
      action: "preferences",
      selectedWorkspaces: ["finances", "mail"],
    }),
  );
});
it("debounces place search, keeps cancel non-mutating, then saves coordinates and returned timezone together", async () => {
  const place = {
    label: "Chicago, Illinois",
    coordinates: { latitude: 41.88, longitude: -87.63 },
    timezone: "America/Chicago",
  };
  h.search.mockResolvedValue([place]);
  show();
  fireEvent.click(screen.getByRole("button", { name: "Home location, Not set" }));
  fireEvent.change(screen.getByLabelText("Search locations"), { target: { value: "Chicago" } });
  expect(h.search).not.toHaveBeenCalled();
  await screen.findByText(place.label);
  expect(h.search).toHaveBeenCalledWith("Chicago");
  fireEvent.click(screen.getByText("Cancel picker"));
  expect(h.update).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Home location, Not set" }));
  fireEvent.change(screen.getByLabelText("Search locations"), { target: { value: "Chicago" } });
  await screen.findByText(place.label);
  fireEvent.click(screen.getByText(place.label));
  expect((screen.getByLabelText("Timezone") as HTMLSelectElement).value).toBe("America/Chicago");
  fireEvent.click(screen.getByText("Save changes"));
  await waitFor(() =>
    expect(h.update).toHaveBeenCalledWith({
      planningTimezone: "America/Chicago",
      homeLocation: place,
    }),
  );
});
it("retains the selected home place on failed search and only clears it after an explicit saved draft", async () => {
  h.user = { ...initial(), homeLocation: { label: "Home city", timezone: "UTC" } };
  h.search.mockRejectedValueOnce(new Error("Unavailable")).mockResolvedValueOnce([]);
  show();
  fireEvent.click(screen.getByRole("button", { name: "Home location, Home city" }));
  fireEvent.change(screen.getByLabelText("Search locations"), { target: { value: "Nowhere" } });
  await screen.findByText("Retry locations");
  fireEvent.click(screen.getByText("Retry locations"));
  await screen.findByText("No locations found.");
  fireEvent.click(screen.getByText("Clear home location"));
  expect(h.update).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Save changes"));
  await waitFor(() => expect(h.update).toHaveBeenCalledWith({ homeLocation: null }));
});
it("retains user drafts when a server denies Save or account ownership changes during it", async () => {
  h.update.mockRejectedValueOnce(new Error("Offline"));
  show();
  fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Jamie" } });
  fireEvent.click(screen.getByText("Save changes"));
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(h.success).not.toHaveBeenCalled();
  expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe("Jamie");
  expect(screen.queryByText("Offline")).toBeNull();
});
it("keeps invalid typed time visible and represents only valid midnight/end-of-day values", () => {
  const change = vi.fn();
  const { rerender } = render(<ProfileTime label="Clock" value={540} onChange={change} />);
  fireEvent.change(screen.getByLabelText("Clock"), { target: { value: "9:" } });
  expect(change).toHaveBeenLastCalledWith(Number.NaN);
  expect((screen.getByLabelText("Clock") as HTMLInputElement).value).toBe("9:");
  fireEvent.change(screen.getByLabelText("Clock"), { target: { value: "24:00" } });
  expect(change).toHaveBeenLastCalledWith(Number.NaN);
  rerender(<ProfileTime label="Clock" value={1020} onChange={change} end />);
  fireEvent.change(screen.getByLabelText("Clock"), { target: { value: "24:00" } });
  expect(change).toHaveBeenLastCalledWith(1440);
  fireEvent.change(screen.getByLabelText("Clock"), { target: { value: "12:99" } });
  expect(change).toHaveBeenLastCalledWith(Number.NaN);
  rerender(<ProfileTime label="Clock" value={0} onChange={change} disabled />);
  expect((screen.getByLabelText("Clock") as HTMLInputElement).disabled).toBe(true);
});
it("native time selection changes draft minutes, treats end midnight as1440 and collapses Done without choosing on cancel", () => {
  const change = vi.fn();
  const { rerender } = render(
    <NativeProfileTime label="Day ends" value={1440} end onChange={change} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Day ends, Midnight (end of day)" }));
  fireEvent.click(screen.getByText("Cancel native selection"));
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Choose midnight"));
  expect(change).toHaveBeenLastCalledWith(1440);
  fireEvent.click(screen.getByText("Choose 8:45"));
  expect(change).toHaveBeenLastCalledWith(525);
  fireEvent.click(screen.getByText("Done"));
  expect(screen.queryByText("Choose midnight")).toBeNull();
  rerender(<NativeProfileTime label="Day starts" value={0} onChange={change} />);
  fireEvent.click(screen.getByRole("button", { name: /Day starts/ }));
  fireEvent.click(screen.getByText("Choose midnight"));
  expect(change).toHaveBeenLastCalledWith(0);
});

it("opens the existing setup replay only through the authoritative web origin and refreshes account state on return", async () => {
  show();
  fireEvent.click(screen.getByText("View setup experience on the web"));
  expect(h.context).not.toHaveBeenCalled();
  expect(h.open).not.toHaveBeenCalled();
  await act(async () => h.confirm.mock.calls.at(-1)?.[2]());
  await waitFor(() =>
    expect(h.open).toHaveBeenCalledWith("https://fixture.example/setup?replay=1"),
  );
  expect(h.setup).not.toHaveBeenCalled();
  expect(h.success).toHaveBeenCalledWith(
    "Guided setup opened in browser. Return to nohmi to refresh its status.",
    { id: "profile-toast" },
  );
  h.me.mockResolvedValueOnce({
    ...h.user,
    setup: { ...h.user.setup, selectedWorkspaces: ["tasks", "calendar"] },
  });
  act(() => h.foreground?.("background"));
  expect(h.me).not.toHaveBeenCalled();
  act(() => h.foreground?.("active"));
  await waitFor(() =>
    expect(h.accept).toHaveBeenCalledWith(
      expect.objectContaining({
        setup: expect.objectContaining({ selectedWorkspaces: ["tasks", "calendar"] }),
      }),
      1,
    ),
  );
  expect(h.success).toHaveBeenCalledWith("Account setup status refreshed", { id: "profile-toast" });
});
it("validates setup replay origin and reports a refused browser launch without claiming setup completion", async () => {
  expect(setupReplayUrl("http://127.0.0.1:60363/today")).toBe(
    "http://127.0.0.1:60363/setup?replay=1",
  );
  for (const origin of [
    "http://remote.example/today",
    "file:///today",
    "https://user:secret@fixture.example/",
  ])
    expect(() => setupReplayUrl(origin)).toThrow();
  h.open.mockRejectedValueOnce(new Error("Browser unavailable"));
  show();
  fireEvent.click(screen.getByText("View setup experience on the web"));
  await act(async () => h.confirm.mock.calls.at(-1)?.[2]());
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(h.success).not.toHaveBeenCalled();
  act(() => h.foreground?.("active"));
  expect(h.me).not.toHaveBeenCalled();
});

it("edits the account timezone and day schedule as one explicit validated Profile change", async () => {
  show();
  fireEvent.change(screen.getByLabelText("Timezone"), { target: { value: "Europe/London" } });
  fireEvent.change(screen.getByLabelText("Day starts"), { target: { value: "08:00" } });
  fireEvent.change(screen.getByLabelText("Day ends"), { target: { value: "18:30" } });
  expect(h.update).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Save changes"));
  await waitFor(() =>
    expect(h.update).toHaveBeenCalledWith({
      planningTimezone: "Europe/London",
      workdayStartMinute: 480,
      workdayEndMinute: 1110,
    }),
  );
});

it("does not expose a prior Profile draft after a sign-out transition", () => {
  const view = show();
  fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Private draft" } });
  h.signedIn = false;
  h.epoch = 2;
  view.rerender(
    <MobileDataProvider>
      <ProfileSettingsScreen />
    </MobileDataProvider>,
  );
  expect(screen.queryByLabelText("First name")).toBeNull();
  expect(screen.queryByText("Private draft")).toBeNull();
  expect(h.update).not.toHaveBeenCalled();
});
