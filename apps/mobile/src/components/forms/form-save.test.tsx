// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CSSProperties, PropsWithChildren } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FormSave } from "./form-save";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
type Frame = { endCoordinates: { screenY: number } };
const h = vi.hoisted(() => ({
  listeners: new Map<string, Set<(event: Frame) => void>>(),
  subscribe: vi.fn(),
  bottomInset: 34,
}));
vi.mock("react-native", () => {
  const PositionedView = ({ children, style }: PropsWithChildren<{ style: CSSProperties }>) => (
    <div data-testid="save-position" style={style}>
      {children}
    </div>
  );
  return {
    View: PositionedView,
    KeyboardAvoidingView: PositionedView,
    Platform: { OS: "ios" },
    useWindowDimensions: () => ({ width: 390, height: 844 }),
    Keyboard: {
      addListener: (name: string, callback: (event: Frame) => void) => {
        h.subscribe(name);
        const listeners = h.listeners.get(name) ?? new Set();
        listeners.add(callback);
        h.listeners.set(name, listeners);
        return { remove: () => listeners.delete(callback) };
      },
    },
    Pressable: ({
      children,
      accessibilityLabel,
      disabled,
      onPress,
    }: PropsWithChildren<{
      accessibilityLabel: string;
      disabled?: boolean;
      onPress: () => void;
    }>) => (
      <button type="button" aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>
        {children}
      </button>
    ),
  };
});
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: h.bottomInset }),
}));
vi.mock("../../theme", () => ({ useTheme: () => ({ ink: "black" }) }));
vi.mock("../settings-accent", () => ({ useSettingsAccent: () => "blue" }));
vi.mock("../icons", () => ({ Icon: () => null }));
vi.mock("../glass-surface", () => ({
  GlassSurface: ({ children, style }: PropsWithChildren<{ style: CSSProperties }>) => (
    <div data-testid="save-surface" style={style}>
      {children}
    </div>
  ),
}));
const frame = (screenY: number) =>
  act(() => {
    for (const listener of h.listeners.get("keyboardWillChangeFrame") ?? [])
      listener({ endCoordinates: { screenY } });
  });
const hide = () =>
  act(() => {
    for (const listener of h.listeners.get("keyboardDidHide") ?? [])
      listener({ endCoordinates: { screenY: 844 } });
  });
afterEach(cleanup);
beforeEach(() => {
  h.listeners.clear();
  h.subscribe.mockClear();
  h.bottomInset = 34;
});
it("keeps the actual Save above changing keyboard frames and returns to its safe-area position when hidden", () => {
  const save = vi.fn();
  render(<FormSave disabled={false} onPress={save} />);
  expect(screen.getByTestId("save-position")).toHaveStyle({ bottom: "0px", right: "20px" });
  expect(screen.getByTestId("save-surface")).toHaveStyle({ marginBottom: "34px" });
  frame(510);
  expect(screen.getByTestId("save-position")).toHaveStyle({ bottom: "334px" });
  frame(600);
  expect(screen.getByTestId("save-position")).toHaveStyle({ bottom: "244px" });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  expect(save).toHaveBeenCalledOnce();
  hide();
  expect(screen.getByTestId("save-position")).toHaveStyle({ bottom: "0px" });
  expect(screen.getByTestId("save-surface")).toHaveStyle({ marginBottom: "34px" });
});
it("retains explicit offset authority without subscribing to duplicate keyboard events", () => {
  h.bottomInset = 0;
  const view = render(<FormSave disabled onPress={vi.fn()} keyboardOffset={120} />);
  expect(screen.getByTestId("save-position")).toHaveStyle({ bottom: "120px" });
  expect(screen.getByTestId("save-surface")).toHaveStyle({ marginBottom: "16px" });
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  expect(h.subscribe).not.toHaveBeenCalled();
  frame(510);
  hide();
  expect(screen.getByTestId("save-position")).toHaveStyle({ bottom: "120px" });
  view.rerender(<FormSave disabled onPress={vi.fn()} keyboardOffset={0} />);
  expect(screen.getByTestId("save-position")).toHaveStyle({ bottom: "0px" });
  expect(h.subscribe).not.toHaveBeenCalled();
});
it("removes default subscriptions when an explicit offset takes over and resubscribes when default returns", () => {
  const view = render(<FormSave disabled={false} onPress={vi.fn()} />);
  frame(510);
  view.rerender(<FormSave disabled={false} onPress={vi.fn()} keyboardOffset={42} />);
  expect([...h.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
  frame(600);
  hide();
  expect(screen.getByTestId("save-position")).toHaveStyle({ bottom: "42px" });
  view.rerender(<FormSave disabled={false} onPress={vi.fn()} />);
  frame(600);
  expect(screen.getByTestId("save-position")).toHaveStyle({ bottom: "244px" });
});
it("cleans up keyboard subscriptions on unmount and clamps an offscreen keyboard to zero", () => {
  const view = render(<FormSave disabled={false} onPress={vi.fn()} />);
  frame(900);
  expect(screen.getByTestId("save-position")).toHaveStyle({ bottom: "0px" });
  expect(h.listeners.get("keyboardWillChangeFrame")?.size).toBe(1);
  expect(h.listeners.get("keyboardDidHide")?.size).toBe(1);
  view.unmount();
  expect([...h.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
});
