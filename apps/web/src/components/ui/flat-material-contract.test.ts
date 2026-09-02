// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const primitiveFiles = [
  "avatar.tsx",
  "badge.tsx",
  "button.tsx",
  "card.tsx",
  "checkbox.tsx",
  "context-menu.tsx",
  "dialog.tsx",
  "dropdown-menu.tsx",
  "empty.tsx",
  "input-group.tsx",
  "input-otp.tsx",
  "input.tsx",
  "item.tsx",
  "native-select.tsx",
  "popover.tsx",
  "radio-group.tsx",
  "sheet.tsx",
  "sidebar.tsx",
  "slider.tsx",
  "sonner.tsx",
  "switch.tsx",
  "tabs.tsx",
  "textarea.tsx",
  "toggle.tsx",
] as const;

function sourceFor(file: (typeof primitiveFiles)[number]) {
  return readFileSync(new URL(file, import.meta.url), "utf8");
}

function withoutAllowedBoundaries(source: string) {
  return source
    .replace(
      /\b(?:focus-visible|aria-invalid|data-\[[^\]]+\]|forced-colors):[^\s"'`]+/g,
      "",
    )
    .replaceAll("border-transparent", "");
}

describe("flat material primitive contract", () => {
  it.each(primitiveFiles)("keeps %s free of visible resting borders", (file) => {
    expect(withoutAllowedBoundaries(sourceFor(file))).not.toMatch(
      /\b(?:border|border-[trblxy])-(?:border|input|sidebar-border)\b/,
    );
  });

  it.each([
    ["card.tsx", /\bbg-card\b/],
    ["input.tsx", /\bbg-input(?:\/\d+)?\b/],
    ["item.tsx", /\bbg-(?:card|muted)(?:\/\d+)?\b/],
    ["dialog.tsx", /\bbg-(?:card|popover)\b/],
  ] as const)("gives %s a semantic resting fill", (file, fill) => {
    expect(sourceFor(file)).toMatch(fill);
  });
});
