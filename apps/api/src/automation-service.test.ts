import { scheduleIsDue } from "./automation-service.js";

describe("automation schedule evaluation", () => {
  const timeZone = "America/New_York";

  it("requires a valid schedule that has reached its local time", () => {
    expect(
      scheduleIsDue("Daily whenever", null, new Date("2026-07-13T17:00:00.000Z"), timeZone),
    ).toBe(false);
    expect(
      scheduleIsDue("Daily at 13:00 PM", null, new Date("2026-07-13T17:00:00.000Z"), timeZone),
    ).toBe(false);
    expect(
      scheduleIsDue("Daily at 1:00 PM", null, new Date("2026-07-13T16:30:00.000Z"), timeZone),
    ).toBe(false);
    expect(
      scheduleIsDue("Daily at 1:00 PM", null, new Date("2026-07-13T17:00:00.000Z"), timeZone),
    ).toBe(true);
  });

  it("respects weekday schedules and does not repeat on one local day", () => {
    expect(
      scheduleIsDue("Weekdays at 9:00 AM", null, new Date("2026-07-18T14:00:00.000Z"), timeZone),
    ).toBe(false);
    expect(
      scheduleIsDue("Weekdays at 9:00 AM", null, new Date("2026-07-19T14:00:00.000Z"), timeZone),
    ).toBe(false);
    expect(
      scheduleIsDue(
        "Daily at 1:00 PM",
        new Date("2026-07-13T17:05:00.000Z"),
        new Date("2026-07-13T18:00:00.000Z"),
        timeZone,
      ),
    ).toBe(false);
    expect(
      scheduleIsDue(
        "Daily at 1:00 PM",
        new Date("2026-07-13T17:05:00.000Z"),
        new Date("2026-07-14T17:00:00.000Z"),
        timeZone,
      ),
    ).toBe(true);
  });
});
