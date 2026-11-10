// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CSSProperties, PropsWithChildren } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SettingsAccentProvider } from "../../components/settings-accent";
import {
  SettingsActionRow,
  SettingsDetailRow,
  SettingsIdentity,
  SettingsRow,
} from "./settings-row";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
const h = vi.hoisted(() => ({ fontScale: 1 }));
vi.mock("react-native", () => ({
  useWindowDimensions: () => ({ width: 390, height: 844, fontScale: h.fontScale }),
  Pressable: ({
    children,
    onPress,
    disabled,
    accessibilityLabel,
  }: PropsWithChildren<{
    onPress: () => void;
    disabled?: boolean;
    accessibilityLabel?: string;
  }>) => (
    <button type="button" aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
  View: ({
    children,
    accessibilityLabel,
    style,
  }: PropsWithChildren<{ accessibilityLabel?: string; style?: CSSProperties }>) => (
    <fieldset aria-label={accessibilityLabel} style={style}>
      {children}
    </fieldset>
  ),
  Text: ({ children, style }: PropsWithChildren<{ style?: object | object[] }>) => (
    <span style={Object.assign({}, ...(Array.isArray(style) ? style : [style]))}>{children}</span>
  ),
}));
vi.mock("../../theme", () => ({
  useTheme: () => ({
    ink: "#202024",
    secondary: "#626268",
    warning: "#89501b",
    destructive: "#ba2944",
  }),
  workspaceColor: () => "#7928ff",
  spacing: { lg: 16, md: 12, xs: 4 },
}));
vi.mock("../../components/icons", () => ({
  Icon: ({ name, color }: { name: string; color: string }) => (
    <span data-testid={`icon-${name}`} style={{ color }} />
  ),
}));
afterEach(cleanup);
beforeEach(() => {
  h.fontScale = 1;
});
it("uses neutral account actions, one semantic icon and disabled state without a navigation accessory", () => {
  const press = vi.fn();
  const view = render(
    <SettingsAccentProvider>
      <SettingsActionRow label="Sync now" icon="refresh" onPress={press} />
    </SettingsAccentProvider>,
  );
  expect(screen.getByText("Sync now")).toHaveStyle({ color: "#202024" });
  expect(screen.getByTestId("icon-refresh")).toHaveStyle({ color: "#202024" });
  expect(screen.queryByTestId("icon-chevron")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
  expect(press).toHaveBeenCalledOnce();
  view.rerender(
    <SettingsAccentProvider>
      <SettingsActionRow label="Sync now" icon="refresh" onPress={press} disabled />
    </SettingsAccentProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
  expect(press).toHaveBeenCalledOnce();
});
it("renders a destructive action red while metadata and account identity remain noninteractive", () => {
  render(
    <SettingsAccentProvider>
      <SettingsIdentity name="Alex Morgan" detail="alex@nohmi.test" leading={<span>AM</span>} />
      <SettingsDetailRow label="Status" value="Needs attention" attention icon="attention" />
      <SettingsActionRow
        label="Disconnect account"
        icon="disconnected"
        destructive
        onPress={() => {}}
      />
    </SettingsAccentProvider>,
  );
  expect(screen.getByText("Alex Morgan").closest("button")).toBeNull();
  expect(screen.getByText("alex@nohmi.test").closest("button")).toBeNull();
  expect(screen.getByText("Needs attention")).toHaveStyle({ color: "#89501b" });
  expect(screen.getByText("Disconnect account")).toHaveStyle({ color: "#ba2944" });
  expect(screen.getByTestId("icon-disconnected")).toHaveStyle({ color: "#ba2944" });
  expect(screen.getAllByRole("button")).toHaveLength(1);
});
it("keeps existing navigation semantics and accepts an explicit provider fallback in action rows", () => {
  const navigate = vi.fn();
  render(
    <SettingsAccentProvider>
      <SettingsRow label="Connections" value="Two accounts" icon="profile" onPress={navigate} />
      <SettingsActionRow
        label="Connect Google in browser"
        leading={<span>Google account</span>}
        onPress={() => {}}
      />
    </SettingsAccentProvider>,
  );
  expect(screen.getByTestId("icon-chevron")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Connections, Two accounts" }));
  expect(navigate).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Connect Google in browser" })).toHaveTextContent(
    "Google account",
  );
});

it("keeps long read-only identities and metadata available without adding focusable or empty controls", () => {
  const name = "A long provider account identity that should remain readable at larger text sizes";
  const detail = "alex.with.a.long.account.identity@fixture.example";
  const value = "November 10, 2026 at 12:34 PM in the account planning timezone";
  render(
    <SettingsAccentProvider>
      <SettingsIdentity name={name} detail={detail} leading={<span>AM</span>} />
      <SettingsIdentity name="Second account" leading={<span>S</span>} />
      <SettingsDetailRow label="Last synced" value={value} icon="clock" />
    </SettingsAccentProvider>,
  );
  expect(screen.getByText(name)).toBeTruthy();
  expect(screen.getByText(detail)).toBeTruthy();
  expect(screen.getByRole("group", { name: `Last synced, ${value}` })).toHaveTextContent(value);
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByText(value)).toHaveStyle({ color: "#626268" });
});

it("stacks navigation labels and full values at larger text sizes while preserving the action and accessories", () => {
  const navigate = vi.fn();
  const label = "Global Policy";
  const value = "Important notifications only, quiet hours from 10 PM to 8 AM";
  const row = () => <SettingsRow label={label} value={value} icon="attention" onPress={navigate} />;
  const view = render(row());
  expect(screen.getByText(label).parentElement).toBe(screen.getByRole("button"));
  expect(screen.getByText(value)).toHaveStyle({ maxWidth: "65%", textAlign: "right" });
  h.fontScale = 1.35;
  view.rerender(row());
  expect(screen.getByText(label).parentElement).toBe(screen.getByText(value).parentElement);
  expect(screen.getByText(label).parentElement).toHaveStyle({
    flexDirection: "column",
  });
  expect(screen.getByText(value)).toHaveStyle({ maxWidth: "100%", textAlign: "left" });
  expect(screen.getByTestId("icon-attention")).toBeTruthy();
  expect(screen.getByTestId("icon-chevron")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: `${label}, ${value}` }));
  expect(navigate).toHaveBeenCalledOnce();
  h.fontScale = 1;
  view.rerender(row());
  expect(screen.getByText(label).parentElement).toBe(screen.getByRole("button"));
  expect(screen.getByText(value)).toHaveStyle({ maxWidth: "65%", textAlign: "right" });
});
it("gives large-text metadata both full-width lines without losing attention color or readonly semantics", () => {
  h.fontScale = 2;
  render(
    <SettingsDetailRow
      label="Connection status"
      value="Needs attention before synchronization can continue"
      attention
      icon="attention"
    />,
  );
  const label = screen.getByText("Connection status");
  const value = screen.getByText("Needs attention before synchronization can continue");
  expect(label.parentElement).toBe(value.parentElement);
  expect(label.parentElement).toHaveStyle({ flexDirection: "column" });
  expect(value).toHaveStyle({ maxWidth: "100%", textAlign: "left", color: "#89501b" });
  expect(
    screen.getByRole("group", {
      name: "Connection status, Needs attention before synchronization can continue",
    }),
  ).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});
