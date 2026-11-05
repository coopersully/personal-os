// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PortfolioCursor } from "./portfolio-cursor";

it("preserves native cursor handoff through scrolling, controls, pointer changes and cleanup", () => {
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
  // The second target gets its cursor from CSS, so restoration must remove the inline override.
  const styles = document.createElement("style");
  styles.textContent = ".cursor-handoff-target { cursor: pointer; }";
  second.className = "cursor-handoff-target";
  const nativeControl = document.createElement("select");
  panel.append(styles, first, second, nativeControl);
  document.body.append(panel);
  let hit: HTMLElement = first;
  const originalHitTest = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => hit });
  const { unmount } = render(<PortfolioCursor />);
  const movePointer = (pointerType: string) => {
    const move = new MouseEvent("pointermove", { clientX: 20, clientY: 30 });
    Object.defineProperty(move, "pointerType", { value: pointerType });
    document.dispatchEvent(move);
  };
  const overlay = () => document.querySelector(".dot-cursor");
  try {
    movePointer("mouse");
    flushFrame();
    expect(first.style.cursor).toBe("none");
    paint = undefined;
    hit = second;
    panel.dispatchEvent(new Event("scroll", { bubbles: false }));
    expect(paint).toBeTypeOf("function");
    flushFrame();
    expect(first.style.cursor).toBe("pointer");
    expect(second.style.cursor).toBe("none");
    expect(overlay()?.hasAttribute("data-visible")).toBe(true);
    hit = nativeControl;
    movePointer("mouse");
    flushFrame();
    expect(second.style.getPropertyValue("cursor")).toBe("");
    expect(second.style.getPropertyPriority("cursor")).toBe("");
    expect(nativeControl.style.getPropertyValue("cursor")).toBe("");
    expect(overlay()?.hasAttribute("data-visible")).toBe(false);
    for (const pointerType of ["touch", "pen"]) {
      hit = second;
      movePointer("mouse");
      flushFrame();
      expect(overlay()?.hasAttribute("data-visible")).toBe(true);
      expect(second.style.cursor).toBe("none");
      movePointer(pointerType);
      expect(overlay()?.hasAttribute("data-visible")).toBe(false);
      expect(second.style.getPropertyValue("cursor")).toBe("");
      expect(second.style.getPropertyPriority("cursor")).toBe("");
    }
    first.style.setProperty("cursor", "pointer", "important");
    hit = first;
    movePointer("mouse");
    flushFrame();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(overlay()?.hasAttribute("data-visible")).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    expect(overlay()?.hasAttribute("data-visible")).toBe(false);
    expect(first.style.getPropertyValue("cursor")).toBe("pointer");
    expect(first.style.getPropertyPriority("cursor")).toBe("important");
    movePointer("mouse");
    flushFrame();
    unmount();
    expect(first.style.cursor).toBe("pointer");
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
