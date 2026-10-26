import { expect, it } from "vitest";
import { formatTimelineClock, localDateTimeAt, positionTimelineEvents } from "./day-timeline";

it("clips overnight events to each displayed day", () => {
  const event = {
    id: "overnight",
    allDay: false,
    startsAt: "2026-10-10T22:00:00Z",
    endsAt: "2026-10-11T01:00:00Z",
  };
  expect(
    positionTimelineEvents([event], { year: 2026, month: 10, day: 10 }, "UTC")[0],
  ).toMatchObject({ startMinute: 1320, endMinute: 1440 });
  expect(
    positionTimelineEvents([event], { year: 2026, month: 10, day: 11 }, "UTC")[0],
  ).toMatchObject({ startMinute: 0, endMinute: 60 });
});
it("uses wall time across a clock change and keeps repeated-hour events visible", () => {
  const event = {
    id: "dst",
    allDay: false,
    startsAt: "2026-11-01T04:00:00Z",
    endsAt: "2026-11-01T08:00:00Z",
  };
  const day = { year: 2026, month: 11, day: 1 };
  expect(positionTimelineEvents([event], day, "America/New_York")[0]).toMatchObject({
    startMinute: 0,
    endMinute: 180,
  });
  expect(
    positionTimelineEvents(
      [{ ...event, startsAt: "2026-11-01T05:30:00Z", endsAt: "2026-11-01T06:30:00Z" }],
      day,
      "America/New_York",
    )[0],
  ).toMatchObject({ startMinute: 90, endMinute: 150 });
});

it("updates both date parts and clock labels when the owner timezone changes", () => {
  const instant = "2026-10-26T01:30:00Z";
  expect(localDateTimeAt(instant, "UTC")).toEqual({
    date: { year: 2026, month: 10, day: 26 },
    minute: 90,
  });
  expect(formatTimelineClock(instant, "UTC")).toBe("1:30 AM");
  expect(localDateTimeAt(instant, "America/New_York")).toEqual({
    date: { year: 2026, month: 10, day: 25 },
    minute: 1290,
  });
  expect(formatTimelineClock(instant, "America/New_York")).toBe("9:30 PM");
  expect(formatTimelineClock(instant, "UTC")).toBe("1:30 AM");
});
