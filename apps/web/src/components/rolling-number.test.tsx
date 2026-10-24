// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { RollingNumber } from "./rolling-number";

const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (originalAnimate) Object.defineProperty(HTMLElement.prototype, "animate", originalAnimate);
  else Reflect.deleteProperty(HTMLElement.prototype, "animate");
});
it("rolls digit carries in both directions while exposing only the settled value", () => {
  const cancel = vi.fn();
  const animate = vi.fn((_frames: Keyframe[] | PropertyIndexedKeyframes) => ({ cancel }));
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
  const { rerender } = render(<RollingNumber value={9} formatted="$9" />);
  expect(animate).not.toHaveBeenCalled();
  rerender(<RollingNumber value={10} formatted="$10" />);
  expect(screen.getByText("$10").closest('[aria-hidden="true"]')).toBeNull();
  const frames = animate.mock.calls[0]?.[0] as unknown as { transform: string }[];
  expect(Number.parseFloat(frames[1]?.transform.slice(11) ?? "0")).toBeLessThan(
    Number.parseFloat(frames[0]?.transform.slice(11) ?? "0"),
  );
  animate.mockClear();
  rerender(<RollingNumber value={9} formatted="$9" />);
  const reverse = animate.mock.calls[0]?.[0] as unknown as { transform: string }[];
  expect(Number.parseFloat(reverse[1]?.transform.slice(11) ?? "0")).toBeGreaterThan(
    Number.parseFloat(reverse[0]?.transform.slice(11) ?? "0"),
  );
  expect(cancel).toHaveBeenCalled();
});
it("updates immediately without rolling when reduced motion is requested", () => {
  const animate = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  const { rerender } = render(<RollingNumber value={10} formatted="$10" />);
  rerender(<RollingNumber value={5} formatted="$5" />);
  expect(screen.getByText("$5")).toBeDefined();
  expect(animate).not.toHaveBeenCalled();
});
