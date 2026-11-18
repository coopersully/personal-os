// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  SettingsAccentProvider,
  settingsWorkspaceForRoute,
  useSettingsAccent,
  useSettingsAccentColor,
} from "./settings-accent";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("../theme", () => ({
  useTheme: () => ({ ink: "ink" }),
  workspaceColor: (_theme: unknown, workspace: string) => `accent:${workspace}`,
}));
afterEach(cleanup);
function Accent() {
  return <output>{useSettingsAccent()}</output>;
}
it("keeps general Settings neutral, scopes workspace descendants, and preserves Tasks outside Settings", () => {
  const { rerender } = render(<Accent />);
  expect(screen.getByRole("status")).toHaveTextContent("accent:tasks");
  rerender(
    <SettingsAccentProvider>
      <Accent />
    </SettingsAccentProvider>,
  );
  expect(screen.getByRole("status")).toHaveTextContent("ink");
  rerender(
    <SettingsAccentProvider workspace="mail">
      <Accent />
    </SettingsAccentProvider>,
  );
  expect(screen.getByRole("status")).toHaveTextContent("accent:mail");
});
it("resolves workspace pages and explicit descendants without leaking a stale workspace onto root", () => {
  expect(settingsWorkspaceForRoute("/settings", { workspace: "tasks" })).toBeNull();
  expect(settingsWorkspaceForRoute("/settings/profile")).toBeNull();
  expect(settingsWorkspaceForRoute("/settings/calendar/new")).toBe("calendar");
  expect(settingsWorkspaceForRoute("/settings/finances/profile")).toBe("finances");
  expect(settingsWorkspaceForRoute("/settings/guidance", { domain: "mail" })).toBe("mail");
  expect(settingsWorkspaceForRoute("/settings/agents", { workspace: ["tasks"] })).toBe("tasks");
  expect(settingsWorkspaceForRoute("/settings/agents", { workspace: "other" })).toBeNull();
});

it("lets neutral switch tracks keep thumb contrast while preserving a workspace tint", () => {
  function Track() {
    return <output>{useSettingsAccentColor("fallback", "gray")}</output>;
  }
  const { rerender } = render(
    <SettingsAccentProvider>
      <Track />
    </SettingsAccentProvider>,
  );
  expect(screen.getByRole("status")).toHaveTextContent("gray");
  rerender(
    <SettingsAccentProvider workspace="mail">
      <Track />
    </SettingsAccentProvider>,
  );
  expect(screen.getByRole("status")).toHaveTextContent("accent:mail");
});
