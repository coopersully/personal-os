// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { calendarFollowPosition, useFollowScroll } from "./use-follow-scroll";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function mount(
  following = false,
  eligible = true,
  snapEnabled = true,
  sensitivity: "precise" | "balanced" | "generous" = "balanced",
) {
  const onEnter = vi.fn(),
    onExit = vi.fn();
  function View() {
    const onScroll = useFollowScroll({
      eligible,
      following,
      minute: 600,
      week: false,
      snapEnabled,
      sensitivity,
      programmatic: { current: null },
      onEnter,
      onExit,
    });
    return <div data-testid="scroll" onScroll={onScroll} />;
  }
  render(<View />);
  const container = screen.getByTestId("scroll");
  Object.defineProperties(container, {
    clientHeight: { value: 400 },
    scrollHeight: { value: 1200 },
    clientWidth: { value: 700 },
    scrollWidth: { value: 700 },
  });
  return { container, onEnter, onExit };
}
it("snaps after settling nearby, not while passing through the target", () => {
  vi.useFakeTimers();
  const { container, onEnter } = mount();
  container.scrollTop = 270;
  fireEvent.scroll(container);
  act(() => vi.advanceTimersByTime(100));
  expect(onEnter).not.toHaveBeenCalled();
  container.scrollTop = 350;
  fireEvent.scroll(container);
  act(() => vi.advanceTimersByTime(200));
  expect(onEnter).not.toHaveBeenCalled();
  container.scrollTop = 290;
  fireEvent.scroll(container);
  act(() => vi.advanceTimersByTime(200));
  expect(container.scrollTop).toBe(280);
  expect(onEnter).toHaveBeenCalledOnce();
});
it("never enters Follow on a period that excludes Today", () => {
  vi.useFakeTimers();
  const { container, onEnter } = mount(false, false);
  container.scrollTop = 280;
  fireEvent.scroll(container);
  act(() => vi.advanceTimersByTime(200));
  expect(onEnter).not.toHaveBeenCalled();
});
it("exits Follow only beyond the larger release threshold", () => {
  const { container, onExit } = mount(true);
  container.scrollTop = 320;
  fireEvent.scroll(container);
  expect(onExit).not.toHaveBeenCalled();
  container.scrollTop = 400;
  fireEvent.scroll(container);
  expect(onExit).toHaveBeenCalledOnce();
});
it("clamps horizontal and vertical targets to reachable edges", () => {
  const { container } = mount();
  container.innerHTML = '<button aria-current="date">Today</button>';
  expect(calendarFollowPosition(container, 1439, true)).toEqual({ left: 0, top: 800 });
  expect(calendarFollowPosition(container, 0, false)).toEqual({ left: 0, top: 0 });
});

it.each([
  ["precise", 6],
  ["balanced", 24],
  ["generous", 96],
] as const)("uses the %s capture range", (sensitivity, threshold) => {
  vi.useFakeTimers();
  const { container, onEnter } = mount(false, true, true, sensitivity);
  container.scrollTop = 280 + threshold + 1;
  fireEvent.scroll(container);
  act(() => vi.advanceTimersByTime(200));
  expect(onEnter).not.toHaveBeenCalled();
  container.scrollTop = 280 + threshold;
  fireEvent.scroll(container);
  act(() => vi.advanceTimersByTime(200));
  expect(onEnter).toHaveBeenCalledOnce();
});
it("does not snap when disabled", () => {
  vi.useFakeTimers();
  const { container, onEnter } = mount(false, true, false);
  container.scrollTop = 280;
  fireEvent.scroll(container);
  act(() => vi.advanceTimersByTime(200));
  expect(onEnter).not.toHaveBeenCalled();
});
