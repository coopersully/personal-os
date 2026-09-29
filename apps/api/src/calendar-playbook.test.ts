import { CALENDAR_PLAYBOOK } from "./calendar-playbook.js";

describe("Calendar stewardship playbook", () => {
  it("provides the fixed assessment horizon, freshness threshold, and primary sources", () => {
    expect(CALENDAR_PLAYBOOK.version).toBe("1.0.0");
    expect(CALENDAR_PLAYBOOK.allOutstanding).toEqual({ futureDays: 90, pastDays: 30 });
    expect(CALENDAR_PLAYBOOK.sourceFreshnessMinutes).toBe(15);
    expect(CALENDAR_PLAYBOOK.research.map(({ publisher }) => publisher)).toEqual(
      expect.arrayContaining(["IETF", "IANA", "Google", "Microsoft Research", "NIOSH", "WHO/ILO"]),
    );
  });
});
