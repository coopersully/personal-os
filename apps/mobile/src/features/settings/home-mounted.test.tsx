// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SettingsHome } from "./home";
import { settingsDestinations } from "./navigation";
import { SettingsRow } from "./settings-row";
import { SettingsScreen } from "./settings-screen";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
const h = vi.hoisted(() => ({ push: vi.fn(), section: "profile" }));
vi.mock("expo-router", () => ({
  router: { push: h.push },
  useLocalSearchParams: () => ({ section: h.section }),
  Stack: { Screen: ({ options }: { options: { title: string } }) => <h1>{options.title}</h1> },
  Redirect: ({ href }: { href: string }) => <a href={href}>Return to Settings</a>,
}));
vi.mock("expo-constants", () => ({
  default: { nativeAppVersion: "2.4.1", nativeBuildVersion: "81" },
}));
vi.mock("../../theme", () => ({
  useTheme: () => ({ ink: "black", secondary: "gray" }),
  workspaceColor: () => "#123456",
}));
vi.mock("../../components/icons", () => ({
  Icon: ({ name }: { name: string }) => <span data-testid={`icon-${name}`} />,
}));
vi.mock("react-native", () => ({
  ScrollView: ({ children }: PropsWithChildren) => <div>{children}</div>,
  View: ({ children }: PropsWithChildren) => <div>{children}</div>,
  Text: ({ children, accessibilityRole }: PropsWithChildren<{ accessibilityRole?: string }>) =>
    accessibilityRole === "header" ? <h2>{children}</h2> : <span>{children}</span>,
  Pressable: ({
    children,
    onPress,
    accessibilityLabel,
    style,
  }: PropsWithChildren<{
    onPress: () => void;
    accessibilityLabel: string;
    style: (state: { pressed: boolean }) => object;
  }>) => (
    <button
      type="button"
      aria-label={accessibilityLabel}
      onClick={onPress}
      style={style({ pressed: false })}
    >
      {children}
    </button>
  ),
  TextInput: ({
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
}));
vi.mock("./profile", () => ({ ProfileSettingsScreen: () => <p>Profile content</p> }));
vi.mock("./security", () => ({ SecuritySettingsScreen: () => <p>Security content</p> }));
vi.mock("./activity", () => ({ ActivitySettingsScreen: () => <p>Activity content</p> }));
vi.mock("./appearance", () => ({ AppearanceSettingsScreen: () => <p>Appearance content</p> }));
vi.mock("./about", () => ({ AboutSettingsScreen: () => <p>About content</p> }));
vi.mock("../goals/settings", () => ({ GoalsSettingsScreen: () => <p>Goals content</p> }));
vi.mock("../rituals/settings", () => ({ RitualsSettingsScreen: () => <p>Rituals content</p> }));
vi.mock("./agents", () => ({ AgentsSettingsScreen: () => <p>Agents content</p> }));
vi.mock("./connections", () => ({ ConnectionsSettingsScreen: () => <p>Connections content</p> }));
vi.mock("./notifications", () => ({
  NotificationsSettingsScreen: () => <p>Notifications content</p>,
}));
vi.mock("./texting", () => ({ TextingSettingsScreen: () => <p>Texting content</p> }));
vi.mock("./workspaces", () => ({
  TaskSettingsScreen: () => <p>Tasks content</p>,
  MailSettingsScreen: () => <p>Mail content</p>,
  CalendarSettingsScreen: () => <p>Calendar content</p>,
  FinanceSettingsScreen: () => <p>Finances content</p>,
}));
beforeEach(() => {
  h.push.mockReset();
  h.section = "profile";
});
afterEach(cleanup);

it("opens every registered destination from the grouped root without a Settings tab bar", () => {
  render(<SettingsHome />);
  expect(screen.getAllByRole("heading").map((heading) => heading.textContent)).toEqual([
    "Account",
    "Personal",
    "Workspaces",
    "Intelligence",
    "App",
  ]);
  for (const destination of settingsDestinations) {
    fireEvent.click(screen.getByRole("button", { name: destination.label }));
    expect(h.push).toHaveBeenLastCalledWith(`/settings/${destination.id}`);
  }
  expect(screen.queryByRole("tablist")).toBeNull();
  expect(screen.queryByRole("button", { name: "About" })).toBeNull();
  expect(screen.getByText("nohmi 2.4.1 · Build 81")).toBeTruthy();
});

it("filters mounted rows by field keywords, reports no results, and restores the root without navigation", () => {
  render(<SettingsHome />);
  const search = screen.getByRole("textbox", { name: "Search settings" });
  fireEvent.change(search, { target: { value: "timezone" } });
  expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Profile"]);
  fireEvent.change(search, { target: { value: "no-matching-setting" } });
  expect(screen.getByText("No settings found")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
  fireEvent.change(search, { target: { value: "" } });
  expect(screen.getAllByRole("button")).toHaveLength(settingsDestinations.length);
  expect(h.push).not.toHaveBeenCalled();
});

it("renders the matching detail screen and redirects unknown sections to the root", () => {
  const mounted = render(<SettingsScreen />);
  expect(screen.getByRole("heading", { name: "Profile" })).toBeTruthy();
  expect(screen.getByText("Profile content")).toBeTruthy();
  h.section = "not-a-setting";
  mounted.rerender(<SettingsScreen />);
  expect(screen.queryByText("Profile content")).toBeNull();
  expect(screen.getByRole("link", { name: "Return to Settings" }).getAttribute("href")).toBe(
    "/settings",
  );
});

it("keeps a current row value in the accessible action name", () => {
  const open = vi.fn();
  render(<SettingsRow label="Timezone" value="America/New York" onPress={open} />);
  fireEvent.click(screen.getByRole("button", { name: "Timezone, America/New York" }));
  expect(open).toHaveBeenCalledOnce();
});
