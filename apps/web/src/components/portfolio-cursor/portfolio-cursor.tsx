import { cursorState, shouldHideCursorOnKey } from "./cursor-state";
import "./cursor.css";
import { useEffect } from "react";

// Adapted from Cooper's portfolio cursor; preserve native input semantics.
export function PortfolioCursor() {
  useEffect(() => installCursor(), []);
  return null;
}
function installCursor() {
  const controller = new AbortController();
  const signal = controller.signal;
  // Progressive enhancement: no CSS hides the native cursor before JS is ready.
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)");
  const accessibleCursor = matchMedia("(forced-colors: active), (prefers-contrast: more)");
  const cursor = document.createElement("div");
  cursor.className = "dot-cursor";
  cursor.setAttribute("aria-hidden", "true");
  const shape = document.createElement("span");
  cursor.append(shape);
  document.body.append(cursor);

  let hiddenTarget: HTMLElement | SVGElement | undefined;
  let originalCursor = "";
  let originalPriority = "";
  let frame = 0;
  let x = 0;
  let y = 0;
  let pressed = false;
  let dragging = false;

  function restoreNative() {
    if (!hiddenTarget) return;
    if (originalCursor) hiddenTarget.style.setProperty("cursor", originalCursor, originalPriority);
    else hiddenTarget.style.removeProperty("cursor");
    hiddenTarget = undefined;
  }
  function hide() {
    cancelAnimationFrame(frame);
    frame = 0;
    pressed = false;
    cursor.removeAttribute("data-visible");
    restoreNative();
  }
  function paint() {
    frame = 0;
    restoreNative();
    if (!finePointer.matches || accessibleCursor.matches || dragging || document.pointerLockElement)
      return hide();
    const target = document.elementFromPoint(x, y);
    // Native popups, resize handles and embedded documents own their cursors.
    if (
      !(target instanceof HTMLElement || target instanceof SVGElement) ||
      target.closest(
        'iframe, video, audio, select, textarea, input[type="file"], [data-native-cursor]',
      )
    )
      return hide();
    const disabled = !!target.closest(':disabled, [aria-disabled="true"]');
    const interactive = !!target.closest(
      'a[href], button, summary, [role="button"], [role="tab"], [role="menuitem"], label[for], input[type="checkbox"], input[type="radio"]',
    );
    const text = !!target.closest(
      'input, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"], p, h1, h2, h3, h4, h5, h6, blockquote, figcaption',
    );
    const state = cursorState(
      getComputedStyle(target).cursor,
      interactive,
      text,
      disabled,
      pressed,
    );
    if (state === "native") return hide();
    cursor.dataset.state = state;
    cursor.dataset.pressed = String(pressed);
    shape.textContent =
      (
        {
          "zoom-in": "+",
          "zoom-out": "−",
          copy: "+",
          alias: "↗",
          help: "?",
          "context-menu": "≡",
          crosshair: "+",
          "resize-x": "↔",
          "resize-y": "↔",
          "resize-nw": "↔",
          "resize-ne": "↔",
        } as Record<string, string>
      )[state] ?? "";
    // Only position changes each frame; never ease the hit point or magnetize it.
    cursor.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    cursor.dataset.visible = "";
    hiddenTarget = target;
    originalCursor = target.style.getPropertyValue("cursor");
    originalPriority = target.style.getPropertyPriority("cursor");
    target.style.setProperty("cursor", "none", "important");
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(paint);
  }
  document.addEventListener(
    "pointermove",
    (event) => {
      if (event.pointerType !== "mouse") return hide();
      x = event.clientX;
      y = event.clientY;
      schedule();
    },
    { passive: true, signal },
  );
  document.addEventListener(
    "pointerdown",
    (event) => {
      pressed = true;
      x = event.clientX;
      y = event.clientY;
      if (event.pointerType === "mouse") schedule();
      else hide();
    },
    { passive: true, signal },
  );
  document.addEventListener(
    "pointerup",
    (event) => {
      pressed = false;
      if (event.pointerType === "mouse") schedule();
      else hide();
    },
    { passive: true, signal },
  );
  document.addEventListener(
    "pointercancel",
    () => {
      pressed = false;
      hide();
    },
    { signal },
  );
  document.addEventListener(
    "pointerout",
    (event) => {
      if (!event.relatedTarget) hide();
    },
    { signal },
  );
  document.addEventListener(
    "dragstart",
    () => {
      dragging = true;
      hide();
    },
    { signal },
  );
  document.addEventListener(
    "dragend",
    () => {
      dragging = false;
      pressed = false;
    },
    { signal },
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (shouldHideCursorOnKey(event.key)) hide();
    },
    { signal },
  );
  document.addEventListener("visibilitychange", hide, { signal });
  window.addEventListener("blur", hide, { signal });
  window.addEventListener("pagehide", hide, { signal });
  window.addEventListener(
    "scroll",
    () => {
      if (cursor.hasAttribute("data-visible")) schedule();
    },
    { passive: true, signal },
  );
  finePointer.addEventListener("change", hide, { signal });
  accessibleCursor.addEventListener("change", hide, { signal });
  return () => {
    controller.abort();
    hide();
    cursor.remove();
  };
}
