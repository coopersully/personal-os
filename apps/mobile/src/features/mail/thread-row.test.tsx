// @vitest-environment jsdom

import type { MailThreadSummary } from "@personal-os/domain";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ThreadRow } from "./thread-row";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("react-native", async () => import("../../../test/native"));
vi.mock("../../components/icons", () => ({ Icon: () => null }));
const h = vi.hoisted(() => ({
  close: vi.fn(),
  haptic: vi.fn().mockResolvedValue(undefined),
  open: vi.fn(),
  action: vi.fn(),
  swipe: undefined as undefined | ((direction: "left" | "right") => void),
}));
vi.mock("expo-haptics", () => ({ selectionAsync: h.haptic }));
vi.mock("react-native-gesture-handler/ReanimatedSwipeable", () => ({
  default: ({
    children,
    ref,
    onSwipeableOpen,
    renderLeftActions,
    renderRightActions,
  }: PropsWithChildren<{
    ref: { current: unknown };
    onSwipeableOpen: typeof h.swipe;
    renderLeftActions?: () => unknown;
    renderRightActions?: () => unknown;
  }>) => {
    ref.current = { close: h.close };
    h.swipe = onSwipeableOpen;
    return (
      <div>
        {children}
        {renderLeftActions?.() as never}
        {renderRightActions?.() as never}
      </div>
    );
  },
}));
const thread = {
  id: "message",
  from: { name: "Maya Chen", address: "maya@example.test" },
  unread: true,
  subject: "Board packet",
  snippet: "The updated agenda is attached",
  messageCount: 2,
  receivedAt: "2026-11-09T12:00:00Z",
} as MailThreadSummary;
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());
function show(pending = false, canArchive = true) {
  render(
    <ThreadRow
      thread={thread}
      pending={pending}
      canArchive={canArchive}
      onAction={h.action}
      onOpen={h.open}
    />,
  );
}
it("renders familiar sender, subject, preview and opens the reader", () => {
  show();
  expect(screen.getByText("Maya Chen")).toBeTruthy();
  expect(screen.getByText("Board packet · 2")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Unread. Maya Chen/ }));
  expect(h.open).toHaveBeenCalledOnce();
});
it("physical swipes dispatch the requested action and close the row", () => {
  show();
  h.swipe?.("left");
  expect(h.action).toHaveBeenLastCalledWith("archive");
  h.swipe?.("right");
  expect(h.action).toHaveBeenLastCalledWith("read");
  expect(h.close).toHaveBeenCalledTimes(2);
  expect(h.haptic).toHaveBeenCalledTimes(2);
});
it("exposes labelled alternatives and blocks pending or unsafe archive actions", () => {
  show();
  fireEvent.click(screen.getByRole("button", { name: "Archive message" }));
  expect(h.action).toHaveBeenCalledWith("archive");
  cleanup();
  h.action.mockClear();
  show(true);
  h.swipe?.("right");
  expect(h.action).not.toHaveBeenCalled();
  cleanup();
  show(false, false);
  h.swipe?.("left");
  expect(h.action).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Archive message" })).toBeNull();
});
