// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { Calendar, User } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { CalendarFloatingNav } from "./floating-nav.js";

const mocks = vi.hoisted(() => ({
  createEvent: vi.fn(),
  listEvents: vi.fn(),
  searchWeatherLocations: vi.fn(),
}));

vi.mock("../../api.js", () => ({
  api: mocks,
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : "Unknown error"),
}));

const user = { id: "user-1" } as User;
const localCalendar = {
  accountId: "account-local",
  color: "#777ce3",
  id: "calendar-local",
  isPrimary: true,
  isSelected: true,
  isWritable: true,
  lastSyncedAt: null,
  name: "Personal",
  provider: "local",
  timezone: "UTC",
} as Calendar;
const googleCalendar = {
  ...localCalendar,
  accountId: "account-google",
  id: "calendar-google",
  isPrimary: false,
  name: "Google",
  provider: "google",
} as Calendar;

function renderCalendar(calendars: Calendar[] = [localCalendar, googleCalendar]) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
        })
      }
    >
      <MemoryRouter>
        <CalendarFloatingNav
          anchor={{ day: 23, month: 8, year: 2026 }}
          calendars={calendars}
          onNavigate={vi.fn()}
          timeZone="UTC"
          user={user}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openConferenceMenu(browser: ReturnType<typeof userEvent.setup>) {
  const trigger =
    screen.queryByRole("button", { name: "Choose conferencing" }) ??
    screen.getByRole("button", { name: "Add conferencing" });
  await browser.click(trigger);
}

describe("Calendar floating navigation edge states", () => {
  beforeEach(() => {
    mocks.createEvent.mockReset();
    mocks.listEvents.mockReset();
    mocks.searchWeatherLocations.mockReset();
  });

  it("shows honest pending and empty search states", async () => {
    const browser = userEvent.setup();
    let resolveEvents: (events: never[]) => void = () => undefined;
    mocks.listEvents.mockReturnValue(
      new Promise<never[]>((resolve) => {
        resolveEvents = resolve;
      }),
    );
    renderCalendar();

    await browser.click(screen.getByRole("button", { name: "Search calendar" }));
    await browser.type(screen.getByRole("textbox", { name: "Search events and dates" }), "zzz");
    expect(await screen.findByText("Searching…")).toBeInTheDocument();
    resolveEvents([]);
    expect(await screen.findByText("No matching events or dates.")).toBeInTheDocument();
  });

  it("submits optional links and keeps provider failures visible", async () => {
    const browser = userEvent.setup();
    let rejectCreate: (error: Error) => void = () => undefined;
    mocks.createEvent.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectCreate = reject;
      }),
    );
    mocks.listEvents.mockResolvedValue([]);
    mocks.searchWeatherLocations.mockRejectedValue(new Error("location search unavailable"));
    renderCalendar();

    await browser.click(screen.getByRole("button", { name: "Create event" }));
    await browser.click(screen.getByRole("button", { name: "Calendar: Personal" }));
    await browser.click(screen.getByRole("button", { name: "Google" }));
    await browser.click(screen.getByRole("button", { name: "Add conferencing" }));
    await openConferenceMenu(browser);
    await browser.click(screen.getByRole("menuitemradio", { name: "Generate Google Meet" }));
    await browser.click(screen.getByRole("button", { name: "Calendar: Google" }));
    await browser.click(screen.getByRole("button", { name: "Personal" }));
    await openConferenceMenu(browser);
    await browser.click(screen.getByRole("menuitemradio", { name: "Paste meeting link" }));
    await browser.type(screen.getByRole("textbox", { name: "Meeting link" }), "https://meet.test");
    await browser.click(screen.getByRole("button", { name: "Add link" }));
    await browser.type(screen.getByRole("textbox", { name: "Link" }), "https://example.test");
    await browser.click(screen.getByRole("switch", { name: "All day" }));
    await browser.type(screen.getByRole("textbox", { name: "Title" }), "Planning day");
    const addLocation = screen.queryByRole("button", { name: "Add location" });
    if (addLocation) await browser.click(addLocation);
    fireEvent.change(screen.getByRole("combobox", { name: "Location" }), {
      target: { value: "Nowhere" },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Location suggestions are unavailable",
    );
    await browser.keyboard("{Escape}");
    await browser.click(screen.getByRole("button", { name: "Create event" }));
    expect(await screen.findByRole("button", { name: "Creating…" })).toBeDisabled();
    rejectCreate(new Error("Provider rejected creation"));
    expect(await screen.findByRole("button", { name: "Create event" })).toBeEnabled();
    await waitFor(() =>
      expect(mocks.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          allDay: true,
          conferenceUrl: "https://meet.test",
          url: "https://example.test",
        }),
      ),
    );
  });

  it("selects the first writable calendar when calendars arrive", async () => {
    const browser = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });
    const renderNav = (calendars: Calendar[]) => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CalendarFloatingNav
            anchor={{ day: 23, month: 8, year: 2026 }}
            calendars={calendars}
            onNavigate={vi.fn()}
            timeZone="UTC"
            user={user}
          />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const view = render(renderNav([]));

    await browser.click(screen.getByRole("button", { name: "Create event" }));
    expect(screen.getByRole("button", { name: "Create event" })).toBeDisabled();

    const zulu = { ...localCalendar, id: "calendar-zulu", isPrimary: false, name: "Zulu" };
    const alpha = { ...localCalendar, id: "calendar-alpha", isPrimary: false, name: "Alpha" };
    view.rerender(renderNav([zulu, alpha]));

    expect(await screen.findByRole("button", { name: "Calendar: Alpha" })).toBeInTheDocument();
  });

  it("shows the year when the default start crosses into a new year", async () => {
    vi.useFakeTimers({ now: new Date("2026-12-31T23:45:00.000Z"), shouldAdvanceTime: true });
    try {
      const browser = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderCalendar();

      await browser.click(screen.getByRole("button", { name: "Create event" }));
      expect(screen.getByRole("button", { name: "Starts date, Jan 1, 2027" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("submits a timed event with hidden optional fields", async () => {
    const browser = userEvent.setup();
    mocks.createEvent.mockReturnValue(new Promise(() => undefined));
    renderCalendar();

    await browser.click(screen.getByRole("button", { name: "Create event" }));
    await browser.type(screen.getByRole("textbox", { name: "Title" }), "Timed planning");
    await browser.click(screen.getByRole("button", { name: "Create event" }));

    await waitFor(() =>
      expect(mocks.createEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          allDay: false,
          location: null,
        }),
      ),
    );
  });
});
