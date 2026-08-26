// @vitest-environment jsdom
import type { User } from "@personal-os/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getWorkspaceCalendarEntry,
  workspaceIndicatorOffset,
  workspaceSwitcherGroupGap,
  workspaceSwitcherRowHeight,
} from "./workspace-switching.js";

const user = { planningTimezone: "America/New_York" } as User;
const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

function stubViewport(narrow: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: narrow }),
  });
}

afterEach(() => {
  if (originalMatchMedia) Object.defineProperty(window, "matchMedia", originalMatchMedia);
  else Reflect.deleteProperty(window, "matchMedia");
});

describe("workspace switcher calendar entry", () => {
  it("warms a single day on narrow screens and a week on wide ones", () => {
    stubViewport(true);
    const narrow = getWorkspaceCalendarEntry(user, "");
    expect(narrow.view).toBe("day");

    stubViewport(false);
    const wide = getWorkspaceCalendarEntry(user, "");
    expect(wide.view).toBe("week");
    // A week has to warm a wider range than a single day.
    expect(new Date(wide.range.to).getTime() - new Date(wide.range.from).getTime()).toBeGreaterThan(
      new Date(narrow.range.to).getTime() - new Date(narrow.range.from).getTime(),
    );
  });

  it("honours an explicit view over the viewport default", () => {
    stubViewport(true);
    expect(getWorkspaceCalendarEntry(user, "?view=month").view).toBe("month");
  });

  it("offsets the selection indicator by row, adding the group gap after the first", () => {
    expect(workspaceIndicatorOffset(0)).toBe(0);
    expect(workspaceIndicatorOffset(2)).toBe(
      2 * workspaceSwitcherRowHeight + workspaceSwitcherGroupGap,
    );
  });
});
