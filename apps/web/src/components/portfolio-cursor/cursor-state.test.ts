import { expect, test } from "vitest";
import { cursorState, shouldHideCursorOnKey } from "./cursor-state";

test("modifiers, typing and shortcuts preserve the pointer; Tab switches to keyboard navigation", () => {
  for (const key of ["Shift", "Control", "Meta", "Alt", "a", "A", "ArrowLeft"]) {
    expect(shouldHideCursorOnKey(key)).toBe(false);
  }
  expect(shouldHideCursorOnKey("Tab")).toBe(true);
});

test("cursor preserves action, selection and disabled meaning", () => {
  expect(cursorState("auto")).toBe("dot");
  expect(cursorState("auto", true, true)).toBe("link");
  expect(cursorState("auto", false, true)).toBe("text");
  expect(cursorState("pointer", true, false, true)).toBe("blocked");
  expect(cursorState("grab", false, false, false, true)).toBe("grabbing");
});
test("special cursors retain direction and native overrides", () => {
  expect(cursorState("col-resize")).toBe("resize-x");
  expect(cursorState("se-resize")).toBe("resize-nw");
  expect(cursorState("sw-resize")).toBe("resize-ne");
  expect(cursorState("wait")).toBe("busy");
  expect(cursorState("zoom-out")).toBe("zoom-out");
  expect(cursorState("none")).toBe("native");
  expect(cursorState("url(custom.svg), pointer")).toBe("native");
  expect(cursorState("unknown")).toBe("native");
});
