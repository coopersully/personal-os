import {
  resolveTodaySettings,
  todayPreferencesSchema,
  todayWeekRange,
  updateTodaySettingsSchema,
} from "./today.js";

describe("Today presentation preferences", () => {
  it("supplies defaults without treating Today as a workspace", () => {
    expect(resolveTodaySettings(null)).toEqual({
      revision: 0,
      preferences: {
        background: "default",
        showSpending: false,
        showRitual: false,
        showPet: true,
        spendingWindow: "week",
        commitmentFilter: "all",
        includeUndated: false,
      },
    });
  });
  it("patches only supplied fields, without injecting defaults", () => {
    expect(
      updateTodaySettingsSchema.parse({ expectedRevision: 2, preferences: { showSpending: true } }),
    ).toEqual({ expectedRevision: 2, preferences: { showSpending: true } });
    expect(todayPreferencesSchema.safeParse({ background: "video" }).success).toBe(false);
    expect(
      updateTodaySettingsSchema.safeParse({ expectedRevision: -1, preferences: {} }).success,
    ).toBe(false);
    expect(
      updateTodaySettingsSchema.safeParse({
        expectedRevision: 0,
        preferences: { workspace: "today" },
      }).success,
    ).toBe(false);
  });
  it("uses Calendar week boundaries across DST", () => {
    const sunday = todayWeekRange(new Date("2026-11-01T18:00:00Z"), "America/New_York", "sunday");
    expect(sunday).toMatchObject({
      weekStart: "2026-11-01",
      weekEndExclusive: "2026-11-08",
      from: "2026-11-01T04:00:00.000Z",
      to: "2026-11-08T05:00:00.000Z",
    });
    expect(
      todayWeekRange(new Date("2026-11-01T18:00:00Z"), "America/New_York", "monday"),
    ).toMatchObject({ weekStart: "2026-10-26", weekEndExclusive: "2026-11-02" });
  });
});
