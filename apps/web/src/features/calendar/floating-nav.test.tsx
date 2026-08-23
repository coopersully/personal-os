// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { User } from "@personal-os/domain";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CalendarFloatingNav } from "./floating-nav.js";

const user = { id: "user-1" } as User;

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
