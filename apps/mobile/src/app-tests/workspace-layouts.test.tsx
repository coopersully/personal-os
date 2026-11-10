// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Finances from "../app/(workspaces)/finances/_layout";
import Mail from "../app/(workspaces)/mail/_layout";
import Tasks from "../app/(workspaces)/tasks/_layout";
import SettingsRoot, { unstable_settings } from "../app/settings/_layout";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
const navigation = vi.hoisted(() => ({
  canGoBack: vi.fn(() => true),
  back: vi.fn(),
  replace: vi.fn(),
  dismiss: undefined as undefined | (() => void),
}));
vi.mock("../components/editor-header", () => ({
  editorDismissOptions: ({ onPress }: { onPress: () => void }) => {
    navigation.dismiss = onPress;
    return {};
  },
}));
vi.mock("../theme", () => ({ useTheme: () => ({ ink: "black", canvas: "white" }) }));
vi.mock("expo-router", () => {
  const Stack = Object.assign(
    ({ screenOptions }: { screenOptions: { headerShown?: boolean; animation?: string } }) => (
      <div
        data-testid="stack"
        data-header={String(screenOptions.headerShown)}
        data-animation={screenOptions.animation}
      />
    ),
    { Screen: () => null },
  );
  return {
    Stack,
    router: navigation,
    usePathname: () => "/settings",
    useGlobalSearchParams: () => ({}),
  };
});
afterEach(cleanup);
it.each([
  Tasks,
  Mail,
  Finances,
])("uses shared chrome without nested headers or competing web stack animations", (Layout) => {
  render(<Layout />);
  expect(screen.getByTestId("stack")).toHaveAttribute("data-header", "false");
  expect(screen.getByTestId("stack")).toHaveAttribute("data-animation", "none");
});
it("keeps regular stack navigation for settings subpages", () => {
  render(<SettingsRoot />);
  expect(screen.getByTestId("stack")).toHaveAttribute("data-header", "undefined");
  expect(screen.getByTestId("stack")).not.toHaveAttribute("data-animation");
});

it("returns Settings to its invoking context and gives cold deep links a root", () => {
  render(<SettingsRoot />);
  navigation.dismiss?.();
  expect(navigation.back).toHaveBeenCalledOnce();
  navigation.canGoBack.mockReturnValue(false);
  navigation.dismiss?.();
  expect(navigation.replace).toHaveBeenCalledWith("/");
  expect(unstable_settings.anchor).toBe("index");
});
