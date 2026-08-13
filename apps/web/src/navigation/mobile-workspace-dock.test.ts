import { describe, expect, it } from "vitest";
import { mobileWorkspacePages } from "./mobile-workspace-dock.js";

describe("mobile workspace dock content", () => {
  it("keeps Today's personal pages together", () => {
    expect(mobileWorkspacePages("today").map((item) => item.label)).toEqual([
      "Today",
      "Reviews",
      "Goals",
      "Motives",
      "Activity",
    ]);
  });

  it("keeps reminders in the Tasks workspace", () => {
    expect(mobileWorkspacePages("tasks").map((item) => item.label)).toContain("Reminders");
  });
});
