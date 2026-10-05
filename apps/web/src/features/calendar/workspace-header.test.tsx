import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// @vitest-environment jsdom

import type { User } from "@personal-os/domain";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CalendarAppBarControls } from "./workspace-header.js";

it("uses the compact view menu without losing calendar filters and follows Today", async () => {
  const browser = userEvent.setup();
  const onToday = vi.fn();
  function Header() {
    const location = useLocation();
    return (
      <>
        <CalendarAppBarControls
          accounts={<span>Accounts</span>}
          user={{ planningTimezone: "America/New_York" } as User}
          onToday={onToday}
        />
        <output aria-label="Current route">{location.search}</output>
      </>
    );
  }
  render(
    <MemoryRouter
      initialEntries={["/calendar?view=week&date=2026-09-30&follow=0&calendars=personal"]}
    >
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <TooltipProvider>
          <Header />
        </TooltipProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  await browser.click(screen.getByRole("button", { name: "Calendar view: week" }));
  await browser.click(screen.getByRole("menuitemradio", { name: "Month" }));
  expect(screen.getByLabelText("Current route")).toHaveTextContent("view=month");
  expect(screen.getByLabelText("Current route")).toHaveTextContent("calendars=personal");
  expect(screen.queryByRole("menuitem", { name: "Go to today" })).not.toBeInTheDocument();
  await browser.click(screen.getByRole("button", { name: "Today" }));
  expect(onToday).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Today" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByLabelText("Current route")).toHaveTextContent("follow=1");
});
