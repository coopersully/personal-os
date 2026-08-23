// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { User } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { MotionProvider } from "@/components/motion-provider.js";
import { CalendarFloatingNav } from "./floating-nav.js";

const user = { id: "user-1" } as User;
const calendar = {
  accountId: null,
  color: "#777ce3",
  id: "calendar-1",
  isPrimary: true,
  isSelected: true,
  isWritable: true,
  lastSyncedAt: null,
  name: "Personal",
  provider: "local" as const,
  timezone: "UTC",
};

function renderCalendar() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MotionProvider>
        <MemoryRouter>
          <CalendarFloatingNav
            anchor={{ day: 23, month: 8, year: 2026 }}
            calendars={[calendar]}
            onNavigate={vi.fn()}
            timeZone="UTC"
            user={user}
          />
        </MemoryRouter>
      </MotionProvider>
    </QueryClientProvider>,
  );
}

it("orders the three primary Calendar actions", () => {
  render(
    <MotionProvider>
      <MemoryRouter>
        <CalendarFloatingNav
          anchor={{ day: 23, month: 8, year: 2026 }}
          calendars={[]}
          onNavigate={vi.fn()}
          timeZone="UTC"
          user={user}
        />
      </MemoryRouter>
    </MotionProvider>,
  );

  const actions = screen.getByRole("navigation", { name: "Calendar actions" });
  expect(Array.from(actions.querySelectorAll("button"), (button) => button.ariaLabel)).toEqual([
    "Choose date",
    "Create event",
    "Search calendar",
  ]);
});

it("morphs one persistent surface through every pill action", async () => {
  const browser = userEvent.setup();
  const { container } = renderCalendar();
  const surface = container.querySelector('[data-slot="calendar-floating-surface"]');

  expect(surface).toHaveAttribute("data-state", "closed");
  expect(surface).toHaveStyle({ position: "relative" });
  await browser.click(screen.getByRole("button", { name: "Choose date" }));
  expect(container.querySelector('[data-slot="calendar-floating-surface"]')).toBe(surface);
  expect(surface).toHaveAttribute("data-state", "date");
  const activeContent = surface?.querySelector(
    '.calendar-floating-nav__transition-content:not([aria-hidden="true"])',
  );
  expect((activeContent as HTMLElement).style.transform).toBe("");
  await browser.click(screen.getByRole("button", { name: "Close" }));
  await browser.click(await screen.findByRole("button", { name: "Create event" }));
  expect(container.querySelector('[data-slot="calendar-floating-surface"]')).toBe(surface);
  expect(surface).toHaveAttribute("data-state", "create");
  const composer = container.querySelector(".calendar-floating-nav__composer");
  expect(composer).toBeInTheDocument();
  await browser.click(within(composer as HTMLElement).getByRole("button", { name: "Close" }));
  await browser.click(await screen.findByRole("button", { name: "Search calendar" }));
  expect(container.querySelector('[data-slot="calendar-floating-surface"]')).toBe(surface);
  expect(surface).toHaveAttribute("data-state", "search");
});

it("holds the pill content back while an expanded surface collapses", async () => {
  const { container } = renderCalendar();
  fireEvent.click(screen.getByRole("button", { name: "Create event" }));
  await screen.findByLabelText("Create event");
  await act(() => new Promise((resolve) => setTimeout(resolve, 200)));

  const composer = container.querySelector(".calendar-floating-nav__composer");
  fireEvent.click(within(composer as HTMLElement).getByRole("button", { name: "Close" }));
  await act(() => new Promise((resolve) => setTimeout(resolve, 60)));

  const pill = screen.getByRole("navigation", { name: "Calendar actions" });
  const incoming = pill.closest(".calendar-floating-nav__transition-content") as HTMLElement;
  expect(Number(incoming.style.opacity)).toBeLessThan(0.2);
});

it("lets the schedule controls size to content around a flexible duration line", () => {
  const { container } = renderCalendar();
  fireEvent.click(screen.getByRole("button", { name: "Create event" }));

  expect(container.querySelectorAll('[data-layout="schedule-control"]')).toHaveLength(2);
  expect(container.querySelector('[data-layout="duration-fill"]')).toBeInTheDocument();
});

it("collapses optional event fields back into add actions", () => {
  renderCalendar();
  fireEvent.click(screen.getByRole("button", { name: "Create event" }));

  fireEvent.click(screen.getByRole("button", { name: "Add location" }));
  expect(screen.getByRole("combobox", { name: "Location" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Remove location" }));
  expect(screen.getByRole("button", { name: "Add location" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Add conferencing" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove conferencing" }));
  expect(screen.getByRole("button", { name: "Add conferencing" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Add link" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove related link" }));
  expect(screen.getByRole("button", { name: "Add link" })).toBeInTheDocument();
});

it("moves an earlier end date forward when the start date changes", () => {
  vi.useFakeTimers({ now: new Date("2026-08-23T12:00:00.000Z"), shouldAdvanceTime: true });
  renderCalendar();
  fireEvent.click(screen.getByRole("button", { name: "Create event" }));

  fireEvent.click(screen.getByRole("button", { name: /^Starts date,/ }));
  fireEvent.click(screen.getByRole("button", { name: /Monday, August 24th, 2026/ }));

  expect(screen.getByRole("button", { name: "Ends date, Aug 24" })).toBeInTheDocument();
  vi.useRealTimers();
});

it("repairs a manually selected end time when a later start makes it invalid", async () => {
  vi.useFakeTimers({ now: new Date("2026-08-23T12:00:00.000Z"), shouldAdvanceTime: true });
  renderCalendar();
  fireEvent.click(screen.getByRole("button", { name: "Create event" }));

  fireEvent.change(screen.getByRole("textbox", { name: "Ends hour" }), {
    target: { value: "330" },
  });
  const startHour = screen.getByRole("textbox", { name: "Starts hour" });
  fireEvent.focus(startHour);
  fireEvent.change(startHour, {
    target: { value: "630" },
  });

  await waitFor(() => expect(screen.getByRole("textbox", { name: "Ends hour" })).toHaveValue("7"));
  expect(screen.getByRole("textbox", { name: "Ends minute" })).toHaveValue("30");
  expect(screen.getByRole("button", { name: "Ends AM or PM, PM" })).toBeInTheDocument();
  vi.useRealTimers();
});

it("accepts shorthand time typing and an explicit meridiem", async () => {
  vi.useFakeTimers({ now: new Date("2026-08-23T12:00:00.000Z"), shouldAdvanceTime: true });
  const browser = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  renderCalendar();
  fireEvent.click(screen.getByRole("button", { name: "Create event" }));

  fireEvent.change(screen.getByRole("textbox", { name: "Starts hour" }), {
    target: { value: "230" },
  });
  expect(screen.getByRole("textbox", { name: "Starts hour" })).toHaveValue("2");
  expect(screen.getByRole("textbox", { name: "Starts minute" })).toHaveValue("30");
  await browser.click(screen.getByRole("button", { name: "Starts AM or PM, PM" }));
  await browser.click(await screen.findByRole("menuitemradio", { name: "AM" }));
  expect(screen.getByRole("button", { name: "Starts AM or PM, AM" })).toBeInTheDocument();
  vi.useRealTimers();
});

it("keeps minute entry unformatted until both digits are typed", () => {
  vi.useFakeTimers({ now: new Date("2026-08-23T12:00:00.000Z"), shouldAdvanceTime: true });
  renderCalendar();
  fireEvent.click(screen.getByRole("button", { name: "Create event" }));
  const minute = screen.getByRole("textbox", { name: "Starts minute" });

  fireEvent.change(minute, { target: { value: "" } });
  fireEvent.change(minute, { target: { value: "3" } });
  expect(minute).toHaveValue("3");
  fireEvent.change(minute, { target: { value: "30" } });
  expect(minute).toHaveValue("30");
  vi.useRealTimers();
});

it("selects time segments for replacement and advances completed hours to minutes", () => {
  vi.useFakeTimers({ now: new Date("2026-08-23T12:00:00.000Z"), shouldAdvanceTime: true });
  renderCalendar();
  fireEvent.click(screen.getByRole("button", { name: "Create event" }));
  const hour = screen.getByRole("textbox", { name: "Starts hour" });
  const minute = screen.getByRole("textbox", { name: "Starts minute" });

  fireEvent.focus(hour);
  fireEvent.change(hour, { target: { value: "6" } });
  expect(hour).toHaveValue("6");
  expect(minute).toHaveFocus();
  vi.useRealTimers();
});
