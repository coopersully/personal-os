// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PortfolioCursor } from "./portfolio-cursor";

it("updates the hit target on a nested scroll and restores native cursors on cleanup", () => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("pointer: fine"),
    addEventListener: vi.fn(),
  }));
  let paint: FrameRequestCallback | undefined;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    paint = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const flushFrame = () => {
    const callback = paint;
    paint = undefined;
    callback?.(0);
  };
  const panel = document.createElement("div");
  const first = document.createElement("button");
  const second = document.createElement("button");
  first.style.cursor = "pointer";
  second.style.cursor = "pointer";
  panel.append(first, second);
  document.body.append(panel);
  let hit = first;
  const originalHitTest = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => hit });
  const { unmount } = render(<PortfolioCursor />);
  try {
    const move = new MouseEvent("pointermove", { clientX: 20, clientY: 30 });
    Object.defineProperty(move, "pointerType", { value: "mouse" });
    document.dispatchEvent(move);
    flushFrame();
    expect(first.style.cursor).toBe("none");
    paint = undefined;
    hit = second;
    panel.dispatchEvent(new Event("scroll", { bubbles: false }));
    expect(paint).toBeTypeOf("function");
    flushFrame();
    expect(first.style.cursor).toBe("pointer");
    expect(second.style.cursor).toBe("none");
    unmount();
    expect(second.style.cursor).toBe("pointer");
    expect(document.querySelector(".dot-cursor")).toBeNull();
    paint = undefined;
    panel.dispatchEvent(new Event("scroll", { bubbles: false }));
    expect(paint).toBeUndefined();
  } finally {
    unmount();
    panel.remove();
    if (originalHitTest) Object.defineProperty(document, "elementFromPoint", originalHitTest);
    else Reflect.deleteProperty(document, "elementFromPoint");
    vi.unstubAllGlobals();
  }
});
