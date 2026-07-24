import { minuteToTimelinePixels, scrollTimelineToMinute } from "./calendar-timeline.js";

describe("calendar timeline scrolling", () => {
  it("converts minutes to the shared 64px-per-hour timeline scale", () => {
    expect(minuteToTimelinePixels(90)).toBe(96);
  });

  it("is a safe no-op without a mounted timeline and centers a mounted one", () => {
    expect(() => scrollTimelineToMinute(null, 480)).not.toThrow();
    const container = { clientHeight: 200, scrollTop: 0 };
    scrollTimelineToMinute(container, 480);
    expect(container.scrollTop).toBe(412);
  });
});
