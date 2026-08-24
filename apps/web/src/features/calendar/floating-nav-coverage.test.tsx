// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { Calendar, User } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
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
    vi.restoreAllMocks();
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

  it.each([
    ["pending", "info"],
    ["failure", "warning"],
    [null, null],
  ] as const)("surfaces a %s provider conference outcome", async (conferenceStatus, toastMethod) => {
    const browser = userEvent.setup();
    const info = vi.spyOn(toast, "info");
    const warning = vi.spyOn(toast, "warning");
    mocks.createEvent.mockResolvedValue({ conferenceStatus });
    renderCalendar();

    await browser.click(screen.getByRole("button", { name: "Create event" }));
    await browser.type(screen.getByRole("textbox", { name: "Title" }), "Provider meeting");
    await browser.click(screen.getByRole("button", { name: "Create event" }));

    expect(await screen.findByRole("button", { name: "Create event" })).toBeInTheDocument();
    expect(info).toHaveBeenCalledTimes(toastMethod === "info" ? 1 : 0);
    expect(warning).toHaveBeenCalledTimes(toastMethod === "warning" ? 1 : 0);
  });

  it("validates and normalizes independently edited time segments", () => {
    vi.useFakeTimers({ now: new Date("2026-08-23T12:00:00.000Z"), shouldAdvanceTime: true });
    try {
      renderCalendar();
      fireEvent.click(screen.getByRole("button", { name: "Create event" }));
      const hour = screen.getByRole("textbox", { name: "Starts hour" });
      const minute = screen.getByRole("textbox", { name: "Starts minute" });

      fireEvent.change(hour, { target: { value: "x" } });
      expect(hour).toHaveAttribute("aria-invalid", "true");
      fireEvent.blur(hour);
      expect((hour as HTMLInputElement).value).toBe("12");

      fireEvent.change(hour, { target: { value: "13" } });
      fireEvent.blur(hour);
      expect((hour as HTMLInputElement).value).toBe("12");
      hour.focus();
      fireEvent.change(hour, { target: { value: "1" } });
      expect(hour).toHaveFocus();
      fireEvent.blur(hour);

      fireEvent.change(minute, { target: { value: "99" } });
      expect(minute).toHaveAttribute("aria-invalid", "true");
      fireEvent.blur(minute);
      fireEvent.change(minute, { target: { value: "5" } });
      fireEvent.blur(minute);
      expect(minute).toHaveValue("05");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps all-day dates ordered and repairs an invalid timed end", async () => {
    vi.useFakeTimers({ now: new Date("2026-08-23T12:00:00.000Z"), shouldAdvanceTime: true });
    try {
      const browser = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderCalendar();
      await browser.click(screen.getByRole("button", { name: "Create event" }));
      await browser.click(screen.getByRole("switch", { name: "All day" }));
      await browser.click(screen.getByRole("button", { name: /^Starts date,/ }));
      await browser.click(screen.getByRole("button", { name: /Monday, August 24th, 2026/ }));
      expect(screen.getByRole("button", { name: "Ends date, Aug 24" })).toBeInTheDocument();

      await browser.click(screen.getByRole("button", { name: "Ends date, Aug 24" }));
      await browser.click(screen.getByRole("button", { name: /Sunday, August 23rd, 2026/ }));
      expect(screen.getByRole("button", { name: "Ends date, Aug 24" })).toBeInTheDocument();

      await browser.click(screen.getByRole("switch", { name: "All day" }));
      fireEvent.change(screen.getByRole("textbox", { name: "Ends hour" }), {
        target: { value: "1130" },
      });
      await browser.click(screen.getByRole("button", { name: /Ends AM or PM/ }));
      await browser.click(await screen.findByRole("menuitemradio", { name: "AM" }));
      expect(screen.getByRole("textbox", { name: "Ends hour" })).toHaveValue("1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("selects and clears a suggested event location", async () => {
    const browser = userEvent.setup();
    mocks.searchWeatherLocations.mockResolvedValue([
      {
        coordinates: { latitude: 40.7128, longitude: -74.006 },
        label: "New York, New York, United States",
        timezone: "America/New_York",
      },
    ]);
    renderCalendar();
    await browser.click(screen.getByRole("button", { name: "Create event" }));
    await browser.click(screen.getByRole("button", { name: "Add location" }));
    await browser.type(screen.getByRole("combobox", { name: "Location" }), "New York");
    await browser.click(
      await screen.findByRole("option", { name: "New York, New York, United States" }),
    );
    expect(screen.getByRole("combobox", { name: "Location" })).toHaveValue(
      "New York, New York, United States",
    );
    await browser.clear(screen.getByRole("combobox", { name: "Location" }));
    expect(screen.getByRole("combobox", { name: "Location" })).toHaveValue("");
  });

  it("keeps date surfaces open when the selected date is deselected", async () => {
    const browser = userEvent.setup();
    renderCalendar();

    await browser.click(screen.getByRole("button", { name: "Choose date" }));
    await browser.click(screen.getByRole("button", { name: /Sunday, August 23rd, 2026/ }));
    expect(screen.getByLabelText("Jump to date")).toBeInTheDocument();
    await browser.keyboard("{Escape}");

    await browser.click(screen.getByRole("button", { name: "Create event" }));
    await browser.click(screen.getByRole("button", { name: /^Starts date,/ }));
    const selectedStart = screen.getByRole("button", { name: /Monday, August 24th, 2026/ });
    await browser.click(selectedStart);
    expect(screen.getByRole("button", { name: /Monday, August 24th, 2026/ })).toBeInTheDocument();
  });

  it("sorts equally ranked calendars by name and falls back when a color is missing", async () => {
    const browser = userEvent.setup();
    mocks.listEvents.mockResolvedValue([]);
    renderCalendar([
      { ...localCalendar, color: null, isPrimary: false, name: "Zulu" },
      { ...googleCalendar, isPrimary: false, name: "Alpha" },
    ]);

    await browser.click(screen.getByRole("button", { name: "Create event" }));
    await browser.click(screen.getByRole("button", { name: "Calendar: Alpha" }));
    expect(screen.getByRole("button", { name: "Zulu" }).querySelector("i")).toHaveStyle({
      background: "#777ce3",
    });
  });
});
