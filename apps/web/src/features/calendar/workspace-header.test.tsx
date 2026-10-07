import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// @vitest-environment jsdom

import type { User } from "@personal-os/domain";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CalendarAppBarControls } from "./workspace-header.js";

const mocks = vi.hoisted(() => ({
  getWorkspaceSettings: vi.fn(),
  updateWorkspaceSettings: vi.fn(),
}));
vi.mock("@/api", () => ({ api: mocks }));

it("uses the compact view menu without losing calendar filters and follows Today", async () => {
  mocks.getWorkspaceSettings.mockResolvedValue({ revision: 0, preferences: {} });
  mocks.updateWorkspaceSettings.mockResolvedValue({
    revision: 1,
    preferences: { calendarView: "month" },
  });
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
  expect(screen.queryByRole("menuitem", { name: "Today" })).not.toBeInTheDocument();
  expect(screen.queryByRole("menuitem", { name: "Next week" })).not.toBeInTheDocument();
  await browser.click(screen.getByRole("menuitemradio", { name: "Month" }));
  expect(screen.getByLabelText("Current route")).toHaveTextContent("view=month");
  expect(screen.getByLabelText("Current route")).toHaveTextContent("calendars=personal");
  await browser.click(screen.getByRole("button", { name: "Today" }));
  expect(onToday).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Today" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByLabelText("Current route")).toHaveTextContent("follow=1");
});
it.each([
  "",
  "?view=month",
])("updates automatic view on phone breakpoint changes while preserving URL choices (%s)", async (search) => {
  mocks.getWorkspaceSettings.mockResolvedValue({
    revision: 0,
    preferences: { calendarView: "auto" },
  });
  const listeners = new Set<() => void>();
  const media = {
    matches: false,
    addEventListener: vi.fn((_type, listener) => listeners.add(listener)),
    removeEventListener: vi.fn((_type, listener) => listeners.delete(listener)),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => media),
  );
  try {
    const { unmount } = render(
      <MemoryRouter initialEntries={[`/calendar${search}`]}>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <TooltipProvider>
            <CalendarAppBarControls
              accounts={null}
              user={{ planningTimezone: "UTC" } as User}
              onToday={() => {}}
            />
          </TooltipProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole("button", { name: `Calendar view: ${search ? "month" : "week"}` }),
    ).toBeVisible();
    await act(async () => {
      media.matches = true;
      for (const listener of listeners) listener();
    });
    expect(
      screen.getByRole("button", { name: `Calendar view: ${search ? "month" : "day"}` }),
    ).toBeVisible();
    unmount();
    expect(listeners.size).toBe(0);
  } finally {
    vi.unstubAllGlobals();
  }
});

it.each([
  ["day", "2026-12-31", "2027-01-01", "2026-12-31"],
  ["week", "2026-12-28", "2027-01-04", "2026-12-28"],
  ["month", "2026-01-31", "2026-02-28", "2026-01-28"],
])("keeps compact %s navigation available with safe date boundaries", async (view, start, next, previous) => {
  mocks.getWorkspaceSettings.mockResolvedValue({ revision: 0, preferences: {} });
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === "(max-width: 600px)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  const onToday = vi.fn();
  const browser = userEvent.setup();
  function Header() {
    const location = useLocation();
    return (
      <>
        <CalendarAppBarControls
          accounts={null}
          user={{ planningTimezone: "UTC" } as User}
          onToday={onToday}
        />
        <output aria-label="Current route">{location.search}</output>
      </>
    );
  }
  try {
    render(
      <MemoryRouter
        initialEntries={[
          `/calendar?view=${view}&date=${start}&follow=0&calendars=personal&weekends=0`,
        ]}
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
    const choose = async (name: string) => {
      await browser.click(screen.getByRole("button", { name: `Calendar view: ${view}` }));
      await browser.click(screen.getByRole("menuitem", { name }));
    };
    await choose(`Next ${view}`);
    expect(screen.getByLabelText("Current route")).toHaveTextContent(`date=${next}`);
    expect(screen.getByLabelText("Current route")).toHaveTextContent("follow=0");
    await choose(`Previous ${view}`);
    expect(screen.getByLabelText("Current route")).toHaveTextContent(`date=${previous}`);
    await choose("Today");
    expect(onToday).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Current route")).toHaveTextContent(
      `date=${new Date().toISOString().slice(0, 10)}`,
    );
    expect(screen.getByLabelText("Current route")).toHaveTextContent("follow=1");
    expect(screen.getByLabelText("Current route")).toHaveTextContent(
      "calendars=personal&weekends=0",
    );
  } finally {
    vi.unstubAllGlobals();
  }
});
