import { describe, expect, it } from "vitest";
import { identifyShortcut, shortcutBounds } from "./date-shortcuts";

describe("due-date shortcuts", () => {
  const zone = "America/New_York";
  // 31 October 2026, 10:00 in New York; clocks go back on 1 November.
  const now = new Date("2026-10-31T14:00:00Z");

  it("bounds whole local days and keeps the before bound inside the last day", () => {
    expect(shortcutBounds("today", zone, now)).toEqual({
      after: "2026-10-31T04:00:00.000Z",
      before: "2026-11-01T03:59:59.999Z",
    });
    expect(shortcutBounds("tomorrow", zone, now)).toEqual({
      after: "2026-11-01T04:00:00.000Z",
      before: "2026-11-02T04:59:59.999Z",
    });
    expect(shortcutBounds("next-seven", zone, now)).toEqual({
      after: "2026-10-31T04:00:00.000Z",
      before: "2026-11-07T04:59:59.999Z",
    });
    expect(shortcutBounds("any", zone, now)).toEqual({});
  });

  it("recognises its own bounds and calls anything else a custom range", () => {
    for (const shortcut of ["any", "today", "tomorrow", "next-seven"] as const)
      expect(identifyShortcut(shortcutBounds(shortcut, zone, now), zone, now)).toBe(shortcut);
    expect(identifyShortcut({ after: "2026-10-31T04:00:00.000Z" }, zone, now)).toBe("custom");
    expect(
      identifyShortcut(shortcutBounds("today", zone, now), zone, new Date("2026-11-01T14:00:00Z")),
    ).toBe("custom");
  });
});
