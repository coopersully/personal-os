// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { DayTimeline } from "./day-timeline";

it("keeps an ongoing event from yesterday visible in the collapsed schedule", () => {
  render(
    <DayTimeline
      currentTime={new Date("2026-10-27T00:30:00Z")}
      items={[
        {
          id: "overnight",
          allDay: false,
          startsAt: "2026-10-26T23:00:00Z",
          endsAt: "2026-10-27T01:00:00Z",
        },
      ]}
      timeZone="UTC"
      preview
      renderItem={(item, style) => (
        <li key={item.id} style={style}>
          Overnight event
        </li>
      )}
    />,
  );
  expect(screen.getByText("Overnight event")).toBeVisible();
});
