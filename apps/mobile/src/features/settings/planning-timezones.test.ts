import { expect, it } from "vitest";
import { planningTimezoneChoices, planningTimezones } from "./planning-timezones.js";

it("offers the complete bundled catalog without runtime timezone enumeration", () => {
  const descriptor = Object.getOwnPropertyDescriptor(Intl, "supportedValuesOf");
  Object.defineProperty(Intl, "supportedValuesOf", { configurable: true, value: undefined });
  try {
    const zones = planningTimezoneChoices("US/Eastern");
    expect(zones.length).toBeGreaterThan(400);
    for (const zone of [
      "UTC",
      "America/New_York",
      "America/Los_Angeles",
      "Europe/London",
      "Africa/Nairobi",
      "Asia/Tokyo",
      "Pacific/Auckland",
      "US/Eastern",
    ])
      expect(zones).toContain(zone);
    expect(zones.filter((zone) => zone === "US/Eastern")).toHaveLength(1);
    expect(new Set(planningTimezones).size).toBe(planningTimezones.length);
  } finally {
    if (descriptor) Object.defineProperty(Intl, "supportedValuesOf", descriptor);
  }
});
