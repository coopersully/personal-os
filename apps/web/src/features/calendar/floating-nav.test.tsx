// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { User } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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
      <MemoryRouter>
        <CalendarFloatingNav
          anchor={{ day: 23, month: 8, year: 2026 }}
          calendars={[calendar]}
          onNavigate={vi.fn()}
          timeZone="UTC"
          user={user}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it("keeps schedule health reachable beside the existing Calendar actions", () => {
  render(
    <MemoryRouter>
      <CalendarFloatingNav
        anchor={{ day: 23, month: 8, year: 2026 }}
        calendars={[]}
        onNavigate={vi.fn()}
        timeZone="UTC"
        user={user}
      />
    </MemoryRouter>,
  );

  expect(screen.getByRole("link", { name: "Schedule health" })).toHaveAttribute(
    "href",
    "/calendar/review",
  );
  expect(screen.getByRole("button", { name: "Choose date" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Search calendar" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Create event" })).toBeInTheDocument();
});

it("opens the time picker centered on its selected time", async () => {
  vi.useFakeTimers({ now: new Date("2026-08-23T12:00:00.000Z"), shouldAdvanceTime: true });
  const scrollIntoView = vi.fn();
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
  renderCalendar();

  fireEvent.click(screen.getByRole("button", { name: "Create event" }));
  fireEvent.click(screen.getByRole("button", { name: "Starts time, 12:30 PM" }));

  const selectedTime = screen.getByRole("option", { name: "12:30 PM" });
  await waitFor(() => expect(selectedTime).toHaveFocus());
  expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "center" });
  vi.useRealTimers();
});

it("lets the schedule controls size to content around a flexible duration line", () => {
  const { container } = renderCalendar();
  fireEvent.click(screen.getByRole("button", { name: "Create event" }));

  expect(container.querySelectorAll('[data-layout="schedule-control"]')).toHaveLength(2);
  expect(container.querySelector('[data-layout="duration-fill"]')).toBeInTheDocument();
});
