// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { ApiClientError } from "@personal-os/api-client";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import {
  calendarDragGrabOffset,
  createRangeMinuteAtPointer,
  FatalState,
  scheduledTaskEndsAt,
  startCalendarDrag,
  TodayAllDayEventCard,
  TodayEventCard,
  TodayTaskTimelineCard,
  timelineMinuteAtPointer,
} from "./app";

const event = (values: Record<string, unknown> = {}) =>
  ({
    allDay: false,
    blocks: [],
    calendarId: "calendar",
    conferenceUrl: null,
    endsAt: "2026-09-07T11:00:00.000Z",
    id: "event",
    location: null,
    provider: "local",
    startsAt: "2026-09-07T10:00:00.000Z",
    title: "Planning",
    url: null,
    ...values,
  }) as never;

it("renders all-day, future, ongoing, and quick-action event previews", () => {
  const { rerender } = render(
    <MemoryRouter>
      <TodayEventCard
        calendarColor={null}
        density="full"
        event={event({ allDay: true })}
        timeZone="UTC"
      />
    </MemoryRouter>,
  );
  expect(screen.getByRole("button", { name: /All day Planning/ })).toBeVisible();

  rerender(
    <MemoryRouter>
      <TodayEventCard
        calendarColor="#123456"
        currentTime={new Date("2026-09-07T09:30:00.000Z")}
        density="compact"
        event={event({
          conferenceUrl: "https://meet.example.test/room",
          location: "1 Main Street",
          url: "https://example.test/details",
        })}
        timeZone="UTC"
      />
    </MemoryRouter>,
  );
  expect(screen.getByText("in 30 min")).toBeVisible();
  expect(screen.getByText("1 Main Street")).toBeVisible();

  rerender(
    <MemoryRouter>
      <TodayEventCard
        calendarColor={undefined}
        currentTime={new Date("2026-09-07T10:45:00.000Z")}
        density="full"
        event={event({
          conferenceUrl: "https://meet.example.test/room",
          url: "https://meet.example.test/room",
        })}
        timeZone="UTC"
      />
    </MemoryRouter>,
  );
  expect(screen.getByText("15 min left")).toBeVisible();

  rerender(
    <MemoryRouter>
      <TodayEventCard
        calendarColor={undefined}
        currentTime={new Date("2026-09-07T12:00:00.000Z")}
        density="full"
        event={event({ blocks: [{ calendarId: "other" }], url: "https://example.test" })}
        timeZone="UTC"
      />
    </MemoryRouter>,
  );
  expect(screen.getByLabelText("Blocks another calendar")).toBeVisible();
});

it("renders task timeline states and rejects non-task material", () => {
  const base = {
    endsAt: "2026-09-07T11:00:00.000Z",
    material: { kind: "task", task: { title: "Write update" } },
    startsAt: "2026-09-07T10:00:00.000Z",
  };
  const props = {
    density: "full",
    item: base as never,
    layoutStyle: {},
    onEdit: () => {},
    timeZone: "UTC",
  } as const;
  const { rerender, container } = render(
    <TodayTaskTimelineCard {...props} currentTime={new Date("2026-09-07T09:30:00.000Z")} />,
  );
  expect(screen.getByText("in 30 min")).toBeVisible();
  rerender(<TodayTaskTimelineCard {...props} currentTime={new Date("2026-09-07T10:45:00.000Z")} />);
  expect(screen.getByText("15 min left")).toBeVisible();
  rerender(<TodayTaskTimelineCard {...props} currentTime={new Date("2026-09-07T12:00:00.000Z")} />);
  expect(screen.queryByText(/left|in 30/)).not.toBeInTheDocument();
  rerender(
    <TodayTaskTimelineCard
      {...props}
      item={{ ...base, material: { event: event(), kind: "event" } } as never}
      currentTime={new Date("2026-09-07T12:00:00.000Z")}
    />,
  );
  expect(container).toBeEmptyDOMElement();
});

it("bounds scheduled durations and pointer-derived quarter-hour positions", () => {
  expect(
    scheduledTaskEndsAt({
      estimateMinutes: null,
      scheduledAt: "2026-09-07T10:00:00.000Z",
    } as never).toISOString(),
  ).toBe("2026-09-07T10:30:00.000Z");
  expect(
    scheduledTaskEndsAt({
      estimateMinutes: 5,
      scheduledAt: "2026-09-07T10:00:00.000Z",
    } as never).toISOString(),
  ).toBe("2026-09-07T10:15:00.000Z");

  const timeline = document.createElement("div");
  timeline.getBoundingClientRect = () => ({ height: 1152, top: Number.NaN }) as DOMRect;
  expect(timelineMinuteAtPointer({ clientY: Number.NaN }, timeline)).toBe(0);
  timeline.getBoundingClientRect = () => ({ height: 1152, top: 100 }) as DOMRect;
  expect(timelineMinuteAtPointer({ clientY: 676 }, timeline)).toBe(720);
  expect(createRangeMinuteAtPointer({ clientY: -100 }, timeline)).toBe(0);
  expect(calendarDragGrabOffset({ getData: () => "not-a-number" } as never, "missing")).toBe(0);
  expect(calendarDragGrabOffset({ getData: () => "-20" } as never, "missing")).toBe(0);
  expect(calendarDragGrabOffset({ getData: () => "25" } as never, "missing")).toBe(25);
});

it("records bounded drag metrics and reuses the stable grab offset", () => {
  const element = document.createElement("button");
  element.style.setProperty("--calendar-color", "#112233");
  element.getBoundingClientRect = () => ({ height: 60, left: 10, top: 20, width: 180 }) as DOMRect;
  const values = new Map<string, string>();
  const dataTransfer = {
    effectAllowed: "none",
    getData: (type: string) => values.get(type) ?? "",
    setData: (type: string, value: string) => values.set(type, value),
    setDragImage: () => {},
  };
  const setDragged = vi.fn();
  startCalendarDrag(
    {
      clientX: Number.NaN,
      clientY: Number.NaN,
      currentTarget: element,
      dataTransfer,
    } as never,
    event(),
    setDragged,
  );
  expect(calendarDragGrabOffset(dataTransfer as never, "event")).toBe(0);
  expect(setDragged).toHaveBeenCalledWith("event");
});

it("renders local and connected all-day calendar occasions", () => {
  const onEdit = vi.fn();
  const { rerender } = render(
    <TodayAllDayEventCard
      calendarColor={null}
      event={event({ allDay: true, provider: "local" })}
      onEdit={onEdit}
      timeZone="UTC"
    />,
  );
  expect(screen.getByText("Planning")).toBeVisible();
  rerender(
    <TodayAllDayEventCard
      calendarColor="#abcdef"
      event={event({ allDay: true, provider: "google" })}
      onEdit={onEdit}
      timeZone="UTC"
    />,
  );
  expect(screen.getByRole("img", { name: /Google/i })).toBeVisible();
});

it.each([
  [403, "Access denied"],
  [404, "Page not found"],
  [503, "Back soon"],
  [500, "Server error"],
])("maps API status %s to its bounded error page", (status, title) => {
  render(
    <FatalState error={new ApiClientError({ code: "failure", message: "Failure", status })} />,
  );
  expect(screen.getByRole("heading", { name: title })).toBeVisible();
});
