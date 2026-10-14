// @vitest-environment jsdom
import {
  getDefaultWorkspacePreferences,
  resolveTodaySettings,
  type TodayCommitmentPage,
} from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api";
import { TodayCommitments } from "./commitments";

afterEach(() => vi.restoreAllMocks());
it("returns to the preceding page after its last commitment is completed", async () => {
  vi.spyOn(api, "getTodaySettings").mockResolvedValue(resolveTodaySettings(null));
  vi.spyOn(api, "getWorkspaceSettings").mockResolvedValue({
    workspace: "calendar",
    revision: 0,
    preferences: getDefaultWorkspacePreferences("calendar"),
  } as Awaited<ReturnType<typeof api.getWorkspaceSettings>>);
  let completed = false;
  const query = vi.spyOn(api, "getTodayCommitments").mockImplementation(
    async (input) =>
      ({
        generatedAt: "2026-10-12T16:00:00Z",
        timeZone: "America/New_York",
        weekStart: "2026-10-11",
        weekEndExclusive: "2026-10-18",
        unavailableSources: [],
        counts: { all: completed ? 6 : 7, tasks: completed ? 6 : 7, reminders: 0, overdue: 0 },
        items:
          input?.cursor && completed
            ? []
            : [
                {
                  kind: "task",
                  group: "today",
                  material: {
                    id: input?.cursor ? "last" : "first",
                    title: input?.cursor ? "Last task" : "First task",
                  },
                },
              ],
        nextCursor: input?.cursor || completed ? null : "next",
      }) as unknown as TodayCommitmentPage,
  );
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cache.setQueryData(["me"], { id: "owner" });
  render(
    <MemoryRouter>
      <QueryClientProvider client={cache}>
        <TodayCommitments
          day="2026-10-12"
          renderTask={(task) => <span>{task.title}</span>}
          renderReminder={(reminder) => <span>{reminder.title}</span>}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  await screen.findByText("First task");
  await userEvent.click(screen.getByRole("link", { name: "Go to next page" }));
  await screen.findByText("Last task");
  completed = true;
  await act(async () => {
    await cache.invalidateQueries({ queryKey: ["today-commitments"] });
  });
  await waitFor(() => expect(screen.getByText("Page 1 of 1")).toBeInTheDocument());
  expect(screen.getByText("First task")).toBeInTheDocument();
  expect(query).toHaveBeenCalledWith(expect.objectContaining({ cursor: "next" }));
});

function renderPages(
  fetchPage: (input: Parameters<typeof api.getTodayCommitments>[0]) => Promise<TodayCommitmentPage>,
) {
  vi.spyOn(api, "getTodaySettings").mockResolvedValue({
    ...resolveTodaySettings(null),
    preferences: { ...resolveTodaySettings(null).preferences, commitmentFilter: "tasks" },
  });
  vi.spyOn(api, "getWorkspaceSettings").mockResolvedValue({
    workspace: "calendar",
    revision: 0,
    preferences: getDefaultWorkspacePreferences("calendar"),
  } as Awaited<ReturnType<typeof api.getWorkspaceSettings>>);
  const query = vi.spyOn(api, "getTodayCommitments").mockImplementation(fetchPage);
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <MemoryRouter>
      <QueryClientProvider client={cache}>
        <TodayCommitments
          day="2026-10-14"
          renderTask={(task) => <span>{task.title}</span>}
          renderReminder={(reminder) => <span>{reminder.title}</span>}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { ...view, query, cache };
}
function pageResult(page: number, size = 6): TodayCommitmentPage {
  return {
    generatedAt: "2026-10-14T16:00:00Z",
    timeZone: "UTC",
    weekStart: "2026-10-11",
    weekEndExclusive: "2026-10-18",
    unavailableSources: [],
    counts: { all: 18, tasks: 9, reminders: 9, overdue: 0 },
    items: [
      {
        kind: "task",
        group: "today",
        material: { id: `task-${page}`, title: `Task on page ${page + 1}` },
      },
      {
        kind: "reminder",
        group: "later_this_week",
        material: { id: `reminder-${page}`, title: `Reminder on page ${page + 1}` },
      },
    ],
    nextCursor: (page + 1) * size < 18 ? String(page + 1) : null,
  } as unknown as TodayCommitmentPage;
}

it("opens a numbered page through bound cursors and returns directly to the first page", async () => {
  const { query } = renderPages(async (input) =>
    pageResult(Number(input?.cursor ?? 0), input?.limit),
  );
  await screen.findByText("Page 1 of 3");
  expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  expect(query).toHaveBeenCalledWith({ filter: "all", includeUndated: false, limit: 6 });
  await userEvent.click(screen.getByRole("link", { name: "Page 3" }));
  await screen.findByText("Task on page 3");
  expect(screen.getByRole("link", { name: "Page 3" })).toHaveAttribute("aria-current", "page");
  expect(query).toHaveBeenCalledWith(expect.objectContaining({ cursor: "1" }));
  expect(query).toHaveBeenCalledWith(expect.objectContaining({ cursor: "2" }));
  await userEvent.click(screen.getByRole("link", { name: "Page 1" }));
  await screen.findByText("Task on page 1");
});

it("collapses each category independently and resets pagination when page size changes", async () => {
  const { query } = renderPages(async (input) =>
    pageResult(Number(input?.cursor ?? 0), input?.limit),
  );
  await screen.findByText("Task on page 1");
  const today = screen.getByRole("button", { name: /Today/ });
  await userEvent.click(today);
  expect(today).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByText("Task on page 1")).not.toBeInTheDocument();
  expect(screen.getByText("Reminder on page 1")).toBeVisible();
  await userEvent.click(screen.getByRole("link", { name: "Page 2" }));
  await screen.findByText("Reminder on page 2");
  expect(screen.getByRole("button", { name: /Today/ })).toHaveAttribute("aria-expanded", "false");
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Commitments per page" }),
    "24",
  );
  await screen.findByText("Page 1 of 1");
  expect(query).toHaveBeenCalledWith({ filter: "all", includeUndated: false, limit: 24 });
  expect(screen.getByRole("link", { name: "Go to next page" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
});

it("keeps the current page and reports a cursor navigation failure through Sonner", async () => {
  const failure = vi.spyOn(toast, "error");
  renderPages(async (input) => {
    if (input?.cursor) throw new Error("expired cursor");
    return pageResult(0);
  });
  await screen.findByText("Task on page 1");
  await userEvent.click(screen.getByRole("link", { name: "Page 3" }));
  await waitFor(() =>
    expect(failure).toHaveBeenCalledWith(
      expect.stringContaining("Could not open that page"),
      expect.objectContaining({ action: expect.objectContaining({ label: "Refresh" }) }),
    ),
  );
  expect(screen.getByText("Task on page 1")).toBeVisible();
  expect(screen.queryByText(/Could not open that page/)).not.toBeInTheDocument();
});

it("does not invent a page total when a commitment source is unavailable", async () => {
  renderPages(async () => ({
    ...pageResult(0),
    counts: { all: null, tasks: 9, reminders: null, overdue: null },
    unavailableSources: ["reminders"],
  }));
  await screen.findByText("Page 1 · total unavailable");
  expect(screen.getByText(/Some commitments could not be refreshed/)).toBeVisible();
});
