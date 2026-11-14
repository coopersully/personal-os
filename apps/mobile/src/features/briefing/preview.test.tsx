// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, expect, it, vi } from "vitest";
import Detail from "../../app/detail/[id]";
import Monitoring from "../../app/monitoring";
import Profile from "../../app/profile";
import { WorkspacePage } from "../../components/workspace-page";
import { PreviewProvider } from "./context";
import BriefingHome from "./home";
import { WorkspacePreview } from "./workspace";

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
it("keeps sample briefing navigation explicit and changes sample scenarios without mutating accounts", () => {
  render(
    <>
      <Profile />
      <BriefingHome />
      <Monitoring />
    </>,
    { wrapper },
  );
  expect(screen.getByText("sample day")).toBeVisible();
  expect(screen.getByRole("heading", { name: "needs you" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /two plans at 2 pm/ }));
  expect(h.push).toHaveBeenCalledWith({ pathname: "/detail/[id]", params: { id: "conflict" } });
  fireEvent.click(screen.getByRole("button", { name: "Sample monitoring status" }));
  expect(h.push).toHaveBeenLastCalledWith("/monitoring");
  fireEvent.click(screen.getByRole("radio", { name: "quiet day" }));
  expect(screen.getByText("you’re all caught up.")).toBeVisible();
  expect(screen.getByText("all clear")).toBeVisible();
  fireEvent.click(screen.getByRole("radio", { name: "monitoring interrupted" }));
  expect(screen.getByText("mail paused · see coverage")).toBeVisible();
  expect(screen.getByText(/Paused · example connection expired/)).toBeVisible();
  fireEvent.click(screen.getByRole("radio", { name: "needs attention" }));
  expect(screen.queryByText("mail paused · see coverage")).not.toBeInTheDocument();
  for (const button of screen.getAllByRole("button", { name: "back to briefing" }))
    fireEvent.click(button);
  expect(h.back).toHaveBeenCalledTimes(2);
});
it("opens sample details and a non-sending draft, with a safe missing-item fallback", () => {
  h.id = "conflict";
  const { rerender } = render(<Detail />);
  expect(screen.getByText("sample calendar · no live account data")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "preview a reply to Alex" }));
  expect(h.push).toHaveBeenCalledWith({ pathname: "/detail/[id]", params: { id: "draft" } });
  h.id = "draft";
  rerender(<Detail />);
  expect(screen.getByText("sample draft · nothing will be sent")).toBeVisible();
  h.id = "reply";
  rerender(<Detail />);
  expect(screen.getByRole("heading", { name: "Friday reservation" })).toBeVisible();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  h.id = "missing";
  rerender(<Detail />);
  expect(screen.getByText("This sample item is not available.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "back to today" }));
  expect(h.replace).toHaveBeenCalledWith("/");
});
it("shows sample workspace items and leaves unimplemented financial data clearly empty", () => {
  const { rerender } = render(<WorkspacePreview workspace="mail" />);
  expect(screen.getByText("sample workspace · your accounts are not connected")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /Maya needs a reply/ }));
  expect(h.push).toHaveBeenCalledWith({ pathname: "/detail/[id]", params: { id: "reply" } });
  rerender(<WorkspacePreview workspace="finances" />);
  expect(screen.getByText(/No financial data is loaded/)).toBeVisible();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  rerender(<WorkspacePage title="planning" />);
  expect(screen.getByRole("heading", { name: "planning" })).toBeVisible();
});

vi.mock("../auth/context", () => ({ useOptionalAuth: () => null }));

vi.mock("sonner-native", () => ({ toast: { error: vi.fn() } }));
