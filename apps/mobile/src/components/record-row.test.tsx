// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { RecordRow } from "./record-row";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("react-native", async () => {
  const native = await import("../../test/native");
  return {
    ...native,
    View: ({
      children,
      accessible,
      accessibilityHint,
    }: PropsWithChildren<{ accessible?: boolean; accessibilityHint?: string }>) => (
      <div role={accessible ? "group" : undefined} aria-description={accessibilityHint}>
        {children}
      </div>
    ),
    Pressable: ({
      children,
      accessibilityHint,
      onPress,
    }: PropsWithChildren<{ accessibilityHint?: string; onPress?: () => void }>) => (
      <button type="button" aria-description={accessibilityHint} onClick={onPress}>
        {children}
      </button>
    ),
  };
});
vi.mock("./icons", () => ({ Icon: () => null }));
afterEach(cleanup);
it("exposes the reason for a static attention value without advertising an unavailable action", () => {
  render(
    <RecordRow
      title="Status"
      value="Needs attention"
      valueTone="attention"
      leading={null}
      accessibilityHint="Reconnect this account to refresh balances."
    />,
  );
  const row = screen.getByRole("group");
  expect(row).toHaveAccessibleDescription("Reconnect this account to refresh balances.");
  expect(row).toHaveTextContent("Status");
  expect(row).toHaveTextContent("Needs attention");
  expect(screen.queryByRole("button")).toBeNull();
});
it("retains the hint and action on an editable row, and leaves ordinary static content ungrouped", () => {
  const press = vi.fn();
  const view = render(
    <RecordRow
      title="Category"
      value="Uncategorized"
      leading={null}
      accessibilityHint="Choose a category for this transaction."
      onPress={press}
    />,
  );
  const row = screen.getByRole("button");
  expect(row).toHaveAccessibleDescription("Choose a category for this transaction.");
  fireEvent.click(row);
  expect(press).toHaveBeenCalledOnce();
  view.rerender(<RecordRow title="Account" value="Checking" leading={null} />);
  expect(screen.getByText("Checking")).toBeVisible();
  expect(screen.queryByRole("group")).toBeNull();
});
