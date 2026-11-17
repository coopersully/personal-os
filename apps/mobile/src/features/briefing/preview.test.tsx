// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, expect, it, vi } from "vitest";
import Monitoring from "../../app/monitoring";
import Profile from "../../app/profile";
import { WorkspacePage } from "../../components/workspace-page";
import { PreviewProvider } from "./context";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("react-native", async () => {
  const native = await import("../../../test/native");
  return { ...native, Animated: { View: native.View } };
});
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 20 }),
}));
vi.mock("../../navigation/workspace-motion", () => ({ useWorkspaceMotion: () => null }));
vi.mock("../../components/icons", () => ({ Icon: () => null }));
const h = vi.hoisted(() => ({ id: "conflict", push: vi.fn(), replace: vi.fn(), back: vi.fn() }));
vi.mock("expo-router", () => ({ router: h, useLocalSearchParams: () => ({ id: h.id }) }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const wrapper = ({ children }: PropsWithChildren) => <PreviewProvider>{children}</PreviewProvider>;
it("changes the preview scenario without reading accounts and returns to the briefing", () => {
  render(
    <>
      <Profile />
      <Monitoring />
    </>,
    { wrapper },
  );
  expect(screen.getAllByText("Example check · 9:39 am")).toHaveLength(3);
  fireEvent.click(screen.getByRole("radio", { name: "monitoring interrupted" }));
  expect(screen.getByText(/Paused · example connection expired/)).toBeVisible();
  fireEvent.click(screen.getByRole("radio", { name: "needs attention" }));
  expect(screen.queryByText(/Paused · example connection expired/)).not.toBeInTheDocument();
  for (const button of screen.getAllByRole("button", { name: "back to briefing" }))
    fireEvent.click(button);
  expect(h.back).toHaveBeenCalledTimes(2);
});
it("renders a plain workspace page heading", () => {
  render(<WorkspacePage title="planning" />);
  expect(screen.getByRole("heading", { name: "planning" })).toBeVisible();
});

vi.mock("../auth/context", () => ({ useOptionalAuth: () => null }));

vi.mock("sonner-native", () => ({ toast: { error: vi.fn() } }));
