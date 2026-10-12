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
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText("Last task");
  completed = true;
  await act(async () => {
    await cache.invalidateQueries({ queryKey: ["today-commitments"] });
  });
  await waitFor(() => expect(screen.getByText("Page 1")).toBeInTheDocument());
  expect(screen.getByText("First task")).toBeInTheDocument();
  expect(query).toHaveBeenCalledWith(expect.objectContaining({ cursor: "next" }));
});
