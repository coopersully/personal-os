import { calendarPeriodDays } from "./page.js";

describe("Calendar periods", () => {
  it("includes all seven days when weekends are enabled", () => {
    expect(calendarPeriodDays("week", { day: 23, month: 8, year: 2026 }, true)).toEqual([
      { day: 23, month: 8, year: 2026 },
      { day: 24, month: 8, year: 2026 },
      { day: 25, month: 8, year: 2026 },
      { day: 26, month: 8, year: 2026 },
      { day: 27, month: 8, year: 2026 },
      { day: 28, month: 8, year: 2026 },
      { day: 29, month: 8, year: 2026 },
    ]);
  });
});
