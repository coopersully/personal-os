// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Screen } from "./screen";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
const h = vi.hoisted(() => ({
  platform: { OS: "web" },
  inset: 80,
  motion: true,
  region: vi.fn(),
  scroll: {} as Record<string, unknown>,
}));
vi.mock("react-native", async () => {
  const native = await import("../../test/native");
  return {
    ...native,
    Platform: h.platform,
    Animated: { View: native.View },
    ScrollView: ({ children, ...props }: PropsWithChildren<Record<string, unknown>>) => {
      h.scroll = props;
      return <div data-testid="scroll">{children}</div>;
    },
  };
});
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34 }),
}));
vi.mock("../navigation/workspace-motion", () => ({
  useWorkspaceMotion: () =>
    h.motion ? { workspaceProgress: "vertical", pageProgress: "horizontal" } : null,
  regionMotion: h.region,
}));
vi.mock("./workspace-header-inset", () => ({ useWorkspaceHeaderInset: () => h.inset }));
beforeEach(() => {
  vi.clearAllMocks();
  h.platform.OS = "web";
  h.inset = 80;
  h.motion = true;
});
afterEach(cleanup);
it("keeps hero bounds fixed and delegates native iOS horizontal motion to native navigation", () => {
  h.platform.OS = "ios";
  const onScroll = vi.fn();
  render(
    <Screen chrome edgeToEdge bounces={false} onScroll={onScroll}>
      Briefing
    </Screen>,
  );
  expect(screen.getByText("Briefing")).toBeVisible();
  expect(h.region).toHaveBeenCalledWith("vertical", 20);
  expect(h.region).not.toHaveBeenCalledWith("horizontal", 24, "x");
  expect(h.scroll).toMatchObject({
    bounces: false,
    onScroll,
    contentInsetAdjustmentBehavior: "never",
    automaticallyAdjustKeyboardInsets: true,
    keyboardDismissMode: "interactive",
    scrollIndicatorInsets: { top: 80 },
  });
  expect(h.scroll.contentContainerStyle).toEqual(
    expect.arrayContaining([expect.objectContaining({ paddingTop: 0, paddingBottom: 34 })]),
  );
});
it("uses safe-area adjustment without shared chrome and preserves compact non-scrolling forms", () => {
  h.inset = 0;
  h.motion = false;
  const view = render(<Screen backgroundColor="#ffffff">Form</Screen>);
  expect(h.scroll.contentInsetAdjustmentBehavior).toBe("automatic");
  expect(h.scroll.contentContainerStyle).toEqual(
    expect.arrayContaining([expect.objectContaining({ paddingTop: 16 })]),
  );
  view.rerender(<Screen scroll={false}>Fixed form</Screen>);
  expect(screen.getByText("Fixed form")).toBeVisible();
  expect(screen.queryByTestId("scroll")).toBeNull();
  expect(h.region).not.toHaveBeenCalled();
});
it("keeps web page motion separate from workspace motion and leaves room for sticky chrome", () => {
  render(<Screen chrome>Tasks</Screen>);
  expect(h.region).toHaveBeenCalledWith("horizontal", 24, "x");
  expect(h.scroll.contentContainerStyle).toEqual(
    expect.arrayContaining([expect.objectContaining({ paddingTop: 84 })]),
  );
});

vi.mock("../features/auth/context", () => ({ useOptionalAuth: () => null }));

vi.mock("sonner-native", () => ({ toast: { error: vi.fn() } }));
