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
    expect(calendarPeriodDays("week", { day: 23, month: 8, year: 2026 }, false)).toEqual([
      { day: 24, month: 8, year: 2026 },
      { day: 25, month: 8, year: 2026 },
      { day: 26, month: 8, year: 2026 },
      { day: 27, month: 8, year: 2026 },
      { day: 28, month: 8, year: 2026 },
    ]);
  });
});

it("uses the containing Monday week even for Sunday anchors and keeps workdays aligned", () => {
  const sunday = { day: 4, month: 1, year: 2026 };
  const week = calendarPeriodDays("week", sunday, true, "monday");
  expect(week[0]).toEqual({ day: 29, month: 12, year: 2025 });
  expect(week[6]).toEqual(sunday);
  expect(calendarPeriodDays("week", sunday, false, "monday")).toEqual(week.slice(0, 5));
});

it("aligns month grids to the selected week start across year boundaries", () => {
  expect(calendarPeriodDays("month", { day: 10, month: 1, year: 2026 }, true, "monday")[0]).toEqual(
    { day: 29, month: 12, year: 2025 },
  );
  expect(calendarPeriodDays("month", { day: 10, month: 1, year: 2026 }, true, "sunday")[0]).toEqual(
    { day: 28, month: 12, year: 2025 },
  );
  expect(calendarPeriodDays("day", { day: 4, month: 1, year: 2026 }, false, "monday")).toEqual([
    { day: 4, month: 1, year: 2026 },
  ]);
});
