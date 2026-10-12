import { resolveWorkspaceSettings } from "@personal-os/domain";
// @vitest-environment jsdom

import type { WorkspaceSearchPage } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { api } from "@/api";
import { parseCalendarDateQuery } from "../calendar/search-date";
import { workspaceCatalog } from "./catalog";
import { WorkspaceFinder } from "./search";

function Route() {
  return (
    <output aria-label="Current route">
      {useLocation().pathname}
      {useLocation().search}
    </output>
  );
}
function renderSearch(
  workspace: "calendar" | "tasks" | "mail" | "finances" = "calendar",
  onAction = vi.fn(),
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/${workspace}?view=week`]}>
        <WorkspaceFinder workspace={workspace} timeZone="America/New_York" onAction={onAction} />
        <Route />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /^Search / }));
  return onAction;
}
beforeEach(() => {
  vi.spyOn(api, "getWorkspaceSettings").mockImplementation(async (workspace) =>
    resolveWorkspaceSettings(workspace),
  );
  vi.spyOn(api, "searchWorkspace").mockResolvedValue({
    items: [],
    nextOffset: null,
    coverage: "synced",
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("opens a setting field without modifying the underlying workspace filters while typing", async () => {
  const user = userEvent.setup();
  renderSearch();
  await user.type(screen.getByRole("combobox", { name: "Search Calendar" }), "weekends");
  expect(screen.getByLabelText("Current route")).toHaveTextContent("/calendar?view=week");
  await user.click(await screen.findByRole("option", { name: /Show weekends/ }));
  expect(screen.getByLabelText("Current route")).toHaveTextContent(
    "/settings?section=calendar&field=calendar%3Ashow-weekends",
  );
});
it("launches creation and reviews through existing destinations", async () => {
  const user = userEvent.setup();
  const onAction = renderSearch("tasks");
  await user.type(
    screen.getByRole("combobox", { name: /^Search (Calendar|Tasks|Mail|Finances)$/ }),
    "new task",
  );
  await user.click(await screen.findByRole("option", { name: /New task/ }));
  expect(onAction).toHaveBeenCalledWith("new-task");
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  await user.click(screen.getByRole("button", { name: "Search Tasks" }));
  await user.type(
    screen.getByRole("combobox", { name: /^Search (Calendar|Tasks|Mail|Finances)$/ }),
    "reviews",
  );
  await user.click(await screen.findByRole("option", { name: /Items needing review/ }));
  expect(screen.getByLabelText("Current route")).toHaveTextContent("/tasks?review=open");
});
it("opens a server result with Enter and passes request cancellation", async () => {
  vi.mocked(api.searchWorkspace).mockResolvedValue({
    items: [
      {
        id: "event",
        kind: "Event",
        title: "Dentist",
        preview: "Oct 4 · Personal",
        href: "/calendar?event=event",
        state: "Hidden calendar",
      },
    ],
    nextOffset: null,
    coverage: "synced",
  });
  const user = userEvent.setup();
  renderSearch();
  const input = screen.getByRole("combobox", { name: /^Search (Calendar|Tasks|Mail|Finances)$/ });
  await user.type(input, "dentist");
  expect(await screen.findByRole("option", { name: /Dentist/ })).toBeInTheDocument();
  await user.keyboard("{ArrowDown}{Enter}");
  expect(screen.getByLabelText("Current route")).toHaveTextContent("/calendar?event=event");
  expect(api.searchWorkspace).toHaveBeenCalledWith(
    "calendar",
    expect.objectContaining({ q: "dentist", includeArchived: true }),
    expect.any(AbortSignal),
  );
});
it("keeps shortcuts available when record search fails, and retries", async () => {
  vi.mocked(api.searchWorkspace).mockRejectedValueOnce(new Error("Offline"));
  const user = userEvent.setup();
  renderSearch("mail");
  await user.type(
    screen.getByRole("combobox", { name: /^Search (Calendar|Tasks|Mail|Finances)$/ }),
    "settings",
  );
  expect(await screen.findByText(/Content search is unavailable/)).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /Mail settings/ })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Retry search" }));
  await waitFor(() =>
    expect(screen.queryByText(/Content search is unavailable/)).not.toBeInTheDocument(),
  );
});
it("shows honest pending and empty states and does not retain results from another query", async () => {
  let finish!: (page: WorkspaceSearchPage) => void;
  vi.mocked(api.searchWorkspace).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const user = userEvent.setup();
  renderSearch();
  await user.type(
    screen.getByRole("combobox", { name: /^Search (Calendar|Tasks|Mail|Finances)$/ }),
    "nonmatchingxyz",
  );
  await waitFor(() => expect(api.searchWorkspace).toHaveBeenCalled());
  expect(screen.getByText("Searching…")).toBeInTheDocument();
  finish({ items: [], nextOffset: null, coverage: "synced" });
  expect(await screen.findByText("No matches found.")).toBeInTheDocument();
});
it("shares the settings field catalog and recognizes weekdays with the account time zone", () => {
  expect(
    workspaceCatalog("calendar", "time zone").some((item) => item.href.includes("section=profile")),
  ).toBe(true);
  expect(workspaceCatalog("finances", "reviews")[0]?.href).toBe("/finances?review=open");
  expect(workspaceCatalog("mail", "unread")[0]?.href).toBe("/mail?unread=1");
  expect(
    parseCalendarDateQuery("next monday", "America/New_York", new Date("2026-10-03T12:00:00Z"))
      ?.date,
  ).toEqual({ day: 5, month: 10, year: 2026 });
  expect(parseCalendarDateQuery("2026-02-30", "UTC")).toBeUndefined();
});

it("renders mobile results inside the drawer and closes after selection", async () => {
  const originalWidth = window.innerWidth;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  try {
    renderSearch("tasks");
    const dialog = screen.getByRole("dialog", { name: "Search Tasks" });
    expect(dialog).toContainElement(screen.getByRole("listbox"));
    fireEvent.change(screen.getByRole("combobox", { name: "Search Tasks" }), {
      target: { value: "reviews" },
    });
    fireEvent.click(screen.getByRole("option", { name: /Items needing review/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Current route")).toHaveTextContent("/tasks?review=open");
  } finally {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
  }
});

it("filters discovery without changing the page and paginates server results", async () => {
  vi.mocked(api.searchWorkspace).mockResolvedValue({
    items: [],
    nextOffset: 20,
    coverage: "synced",
  });
  const user = userEvent.setup();
  renderSearch("mail");
  await user.type(screen.getByRole("combobox", { name: "Search Mail" }), "review");
  await user.click(await screen.findByRole("button", { name: "More results" }));
  await waitFor(() =>
    expect(api.searchWorkspace).toHaveBeenLastCalledWith(
      "mail",
      expect.objectContaining({ offset: 20 }),
      expect.any(AbortSignal),
    ),
  );
  await user.selectOptions(screen.getByRole("combobox", { name: "Search result type" }), "reviews");
  await waitFor(() =>
    expect(api.searchWorkspace).toHaveBeenLastCalledWith(
      "mail",
      expect.objectContaining({ kind: "reviews", offset: 0 }),
      expect.any(AbortSignal),
    ),
  );
  expect(screen.getByLabelText("Current route")).toHaveTextContent("/mail?view=week");
});
