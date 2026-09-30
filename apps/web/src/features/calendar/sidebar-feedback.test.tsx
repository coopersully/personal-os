// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api.js";
import { CalendarSidebar } from "./sidebar.js";

vi.mock("./page.js", () => ({ calendarQueryKeys: { calendars: ["calendars"] } }));
const calendar = {
  id: "work",
  accountId: "account",
  provider: "local" as const,
  name: "Work",
  color: null,
  timezone: "UTC",
  isPrimary: true,
  isSelected: true,
  isWritable: true,
  lastSyncedAt: null,
};
function renderSidebar(
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  }),
) {
  render(
    <QueryClientProvider client={client}>
      <CalendarSidebar />
    </QueryClientProvider>,
  );
  return client;
}
afterEach(() => vi.restoreAllMocks());
describe("Calendar sidebar feedback", () => {
  it("offers retry after an initial load failure without claiming the calendar is empty", async () => {
    vi.spyOn(api, "listCalendars")
      .mockRejectedValueOnce(new Error("private provider detail"))
      .mockResolvedValue([calendar]);
    renderSidebar();
    expect(await screen.findByText("Couldn’t load your calendars.")).toBeInTheDocument();
    expect(screen.queryByText("No calendars are available.")).not.toBeInTheDocument();
    expect(screen.queryByText("private provider detail")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("checkbox", { name: "Work" })).toBeChecked();
  });
  it("keeps stale calendars available after a background refresh failure", async () => {
    vi.spyOn(api, "listCalendars").mockRejectedValue(new Error("provider failed"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["calendars"], [calendar]);
    renderSidebar(client);
    await screen.findByText("Couldn’t load your calendars.");
    expect(screen.getByRole("checkbox", { name: "Work" })).toBeChecked();
  });
  it("restores the saved visibility when changing a calendar fails", async () => {
    vi.spyOn(api, "listCalendars").mockResolvedValue([calendar]);
    vi.spyOn(api, "setCalendarSelected").mockRejectedValue(new Error("provider failed"));
    renderSidebar();
    await userEvent.click(await screen.findByRole("checkbox", { name: "Work" }));
    await waitFor(() => expect(api.setCalendarSelected).toHaveBeenCalledWith("work", false));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Work" })).toBeChecked());
  });
});
