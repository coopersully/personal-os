// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RitualSkipConfirmation } from "./ritual-skip-confirmation.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function setup() {
  vi.useFakeTimers();
  const onConfirm = vi.fn(),
    onCancel = vi.fn();
  render(
    <RitualSkipConfirmation
      count={2}
      streak={8}
      busy={false}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
  return {
    button: screen.getByRole("button", { name: "Hold to skip today" }),
    onConfirm,
    onCancel,
  };
}
it("warns about skips and streak loss; a click cannot skip", () => {
  const { button, onConfirm } = setup();
  expect(screen.getByText(/2 times in the last 3 days/)).toBeInTheDocument();
  expect(screen.getByText(/end your 8-day streak/)).toBeInTheDocument();
  fireEvent.click(button);
  act(() => vi.advanceTimersByTime(30000));
  expect(onConfirm).not.toHaveBeenCalled();
});
it("requires an uninterrupted keyboard hold and confirms once", () => {
  const { button, onConfirm } = setup();
  fireEvent.keyDown(button, { key: " " });
  act(() => vi.advanceTimersByTime(29000));
  expect(screen.getByText("Hold to skip · 1s")).toBeInTheDocument();
  expect(onConfirm).not.toHaveBeenCalled();
  fireEvent.keyUp(button, { key: " " });
  expect(screen.getByText("Hold to skip · 30s")).toBeInTheDocument();
  fireEvent.keyDown(button, { key: "Enter" });
  fireEvent.keyDown(button, { key: "Enter", repeat: true });
  act(() => vi.advanceTimersByTime(30000));
  expect(onConfirm).toHaveBeenCalledTimes(1);
  act(() => vi.advanceTimersByTime(10000));
  expect(onConfirm).toHaveBeenCalledTimes(1);
});
it.each(["blur", "visibilitychange"])("resets on %s", (event) => {
  const { button, onConfirm } = setup();
  fireEvent.keyDown(button, { key: "Enter" });
  act(() => vi.advanceTimersByTime(20000));
  fireEvent(event === "blur" ? window : document, new Event(event));
  act(() => vi.advanceTimersByTime(30000));
  expect(onConfirm).not.toHaveBeenCalled();
});
it("cancels with Escape and reports unavailable history", () => {
  const cancel = vi.fn();
  render(<RitualSkipConfirmation busy={false} onConfirm={vi.fn()} onCancel={cancel} />);
  expect(screen.getByText(/history is unavailable/)).toBeInTheDocument();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(cancel).toHaveBeenCalledOnce();
});
it.each([
  "pointerup",
  "pointerleave",
  "pointercancel",
  "blur",
])("resets a pointer hold on %s", (event) => {
  const { button, onConfirm } = setup();
  fireEvent(button, new MouseEvent("pointerdown", { button: 0, bubbles: true }));
  act(() => vi.advanceTimersByTime(20000));
  expect(screen.getByText("Hold to skip · 10s")).toBeInTheDocument();
  if (event === "pointerleave") fireEvent.pointerOut(button);
  else if (event === "blur") fireEvent.blur(button);
  else fireEvent(button, new MouseEvent(event, { bubbles: true }));
  act(() => vi.advanceTimersByTime(30000));
  expect(onConfirm).not.toHaveBeenCalled();
});
it("accepts a primary pointer hold, ignoring duplicate starts and other buttons/keys", () => {
  const { button, onConfirm } = setup();
  fireEvent(button, new MouseEvent("pointerdown", { button: 2, bubbles: true }));
  fireEvent.keyDown(button, { key: "a" });
  fireEvent.keyUp(button, { key: "a" });
  fireEvent.contextMenu(button);
  act(() => vi.advanceTimersByTime(30000));
  expect(onConfirm).not.toHaveBeenCalled();
  fireEvent(button, new MouseEvent("pointerdown", { button: 0, bubbles: true }));
  act(() => vi.advanceTimersByTime(15000));
  fireEvent(button, new MouseEvent("pointerdown", { button: 0, bubbles: true }));
  act(() => vi.advanceTimersByTime(15000));
  expect(onConfirm).toHaveBeenCalledOnce();
});
it("cleans up an unfinished hold when unmounted", () => {
  vi.useFakeTimers();
  const onConfirm = vi.fn();
  const view = render(
    <RitualSkipConfirmation count={1} busy={false} onConfirm={onConfirm} onCancel={vi.fn()} />,
  );
  const button = screen.getByRole("button", { name: "Hold to skip today" });
  fireEvent.keyDown(button, { key: " " });
  act(() => vi.advanceTimersByTime(25000));
  view.unmount();
  act(() => vi.advanceTimersByTime(30000));
  expect(onConfirm).not.toHaveBeenCalled();
});
it("shows progress while saving and supports backing out", () => {
  const cancel = vi.fn();
  const view = render(<RitualSkipConfirmation busy onConfirm={vi.fn()} onCancel={cancel} />);
  expect(screen.getByRole("button", { name: "Hold to skip today" })).toBeDisabled();
  expect(screen.getByText("Skipping…")).toBeInTheDocument();
  view.rerender(<RitualSkipConfirmation busy={false} onConfirm={vi.fn()} onCancel={cancel} />);
  fireEvent.click(screen.getByRole("button", { name: "Go back" }));
  expect(cancel).toHaveBeenCalledOnce();
});
