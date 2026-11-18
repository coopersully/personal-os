/** Only focus traversal changes input modality, not typing or modifiers. */
export function shouldHideCursorOnKey(key: string) {
  return key === "Tab";
}

export function cursorState(
  cursor: string,
  interactive = false,
  text = false,
  disabled = false,
  pressed = false,
) {
  if (disabled) return "blocked";
  if (cursor.includes("url(")) return "native";
  if (cursor === "none") return "native";
  if (cursor === "auto" || cursor === "default")
    return interactive ? "link" : text ? "text" : "dot";
  if (cursor === "pointer") return "link";
  if (cursor === "text" || cursor === "vertical-text") return cursor;
  if (cursor === "grab") return pressed ? "grabbing" : "grab";
  if (cursor === "grabbing") return "grabbing";
  if (cursor === "not-allowed" || cursor === "no-drop") return "blocked";
  if (cursor === "wait" || cursor === "progress") return "busy";
  if (cursor === "crosshair" || cursor === "cell" || cursor === "move" || cursor === "all-scroll")
    return "crosshair";
  if (["e-resize", "w-resize", "ew-resize", "col-resize"].includes(cursor)) return "resize-x";
  if (["n-resize", "s-resize", "ns-resize", "row-resize"].includes(cursor)) return "resize-y";
  if (["nw-resize", "se-resize", "nwse-resize"].includes(cursor)) return "resize-nw";
  if (["ne-resize", "sw-resize", "nesw-resize"].includes(cursor)) return "resize-ne";
  if (["zoom-in", "zoom-out", "copy", "alias", "help", "context-menu"].includes(cursor))
    return cursor;
  return "native";
}
