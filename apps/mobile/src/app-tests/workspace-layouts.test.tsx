// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Finances from "../app/(workspaces)/finances/_layout";
import Mail from "../app/(workspaces)/mail/_layout";
import SettingsRoot from "../app/(workspaces)/settings/_layout";
import Settings from "../app/(workspaces)/settings/(pages)/_layout";
import Tasks from "../app/(workspaces)/tasks/_layout";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("expo-router", () => ({
  Stack: ({ screenOptions }: { screenOptions: { headerShown: boolean; animation: string } }) => (
    <div
      data-testid="stack"
      data-header={String(screenOptions.headerShown)}
      data-animation={screenOptions.animation}
    />
  ),
}));
afterEach(cleanup);
it.each([
  Tasks,
  Mail,
  Finances,
  Settings,
])("uses shared chrome without nested headers or competing web stack animations", (Layout) => {
  render(<Layout />);
  expect(screen.getByTestId("stack")).toHaveAttribute("data-header", "false");
  expect(screen.getByTestId("stack")).toHaveAttribute("data-animation", "none");
});
it("keeps regular stack navigation for settings subpages", () => {
  render(<SettingsRoot />);
  expect(screen.getByTestId("stack")).toHaveAttribute("data-header", "false");
  expect(screen.getByTestId("stack")).toHaveAttribute("data-animation", "default");
});
