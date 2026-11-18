import { describe, expect, it } from "vitest";
import { settingsParents, settingsPath, settingsRoute } from "./settings-routes";

describe("Settings URL hierarchy", () => {
  it("routes old motive links to the combined page", () => {
    expect(settingsPath("motives")).toBe("/settings?page=goals");
    expect(settingsRoute("?page=motives")).toBe("goals");
    expect(settingsRoute("?section=motives")).toBe("goals");
  });
  it("builds page destinations", () => {
    expect(settingsPath("profile")).toBe("/settings?page=profile");
    expect(settingsPath("calendar")).toBe("/settings?page=calendar");
  });
  it("round trips every registered subpage", () => {
    for (const [subpage, parent] of Object.entries(settingsParents)) {
      const path = settingsPath(subpage);
      expect(path).toBe(`/settings?page=${parent}&subpage=${subpage}`);
      expect(settingsRoute(path.slice(path.indexOf("?")))).toBe(subpage);
    }
  });
  it("rejects a subpage attached to the wrong parent", () => {
    expect(settingsRoute("?page=calendar&subpage=setup")).toBe("calendar");
  });
  it("accepts legacy destinations for canonical redirects", () => {
    expect(settingsRoute("?section=setup&field=test")).toBe("setup");
    expect(settingsRoute("")).toBe("profile");
  });
});
