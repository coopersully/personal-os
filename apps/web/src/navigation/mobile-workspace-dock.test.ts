import { describe, expect, it } from "vitest";
import { mobileWorkspacePages } from "./mobile-workspace-dock.js";

describe("mobile workspace dock content", () => {
  it("keeps account settings out of the Today workspace", () => {
    expect(mobileWorkspacePages("today").map((item) => item.label)).toEqual(["Today"]);
  });

  it("keeps reminders in the Tasks workspace", () => {
    expect(mobileWorkspacePages("tasks").map((item) => item.label)).toContain("Reminders");
  });
});
