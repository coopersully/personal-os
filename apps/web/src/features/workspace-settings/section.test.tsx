// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { resolveWorkspaceSettings, type SearchableWorkspace } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { api } from "@/api";
import { WorkspacePreferencesSection } from "./section";

beforeEach(() => {
  let preferences: Record<string, unknown> = {};
  let revision = 0;
  vi.spyOn(api, "listTaskLists").mockResolvedValue({ items: [], nextCursor: null });
  vi.spyOn(api, "getWorkspaceSettings").mockImplementation(async (workspace) =>
    resolveWorkspaceSettings(workspace, { ...preferences, revision }),
  );
  vi.spyOn(api, "updateWorkspaceSettings").mockImplementation(async (workspace, input) => {
    expect(input.expectedRevision).toBe(revision);
    preferences = { ...preferences, ...input.preferences };
    return resolveWorkspaceSettings(workspace, { ...preferences, revision: ++revision });
  });
});
afterEach(() => vi.restoreAllMocks());
async function show(workspace: SearchableWorkspace) {
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <MemoryRouter>
        <WorkspacePreferencesSection workspace={workspace} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(
      screen.getByRole("switch", { name: "Include completed and archived items in search" }),
    ).toBeEnabled(),
  );
  return userEvent.setup();
}
async function select(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  value: string,
  patch: object,
) {
  await user.selectOptions(screen.getByLabelText(label), value);
  await waitFor(() =>
    expect(api.updateWorkspaceSettings).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ preferences: patch }),
    ),
  );
  await waitFor(() => expect(screen.getByLabelText(label)).toBeEnabled());
}
it("persists Calendar choices independently with the latest revision", async () => {
  const user = await show("calendar");
  await select(user, "Preferred view", "month", { calendarView: "month" });
  for (const [label, key] of [
    ["Automatically follow today", "autoFollowToday"],
    ["Show weekends", "showWeekends"],
    ["Snap back to Follow", "snapToFollow"],
  ] as const) {
    await user.click(screen.getByRole("switch", { name: label }));
    await waitFor(() =>
      expect(api.updateWorkspaceSettings).toHaveBeenLastCalledWith(
        "calendar",
        expect.objectContaining({ preferences: { [key]: false } }),
      ),
    );
    await waitFor(() => expect(screen.getByRole("switch", { name: label })).toBeEnabled());
  }
  expect(screen.getByLabelText("Follow snap sensitivity")).toBeDisabled();
  await user.click(screen.getByRole("switch", { name: "Snap back to Follow" }));
  await waitFor(() => expect(screen.getByLabelText("Follow snap sensitivity")).toBeEnabled());
  await select(user, "Follow snap sensitivity", "precise", { followSnapSensitivity: "precise" });
});
it("persists Mail layout and validates split width before saving", async () => {
  const user = await show("mail");
  await select(user, "Conversation layout", "single", { mailConversationLayout: "single" });
  await select(user, "Conversation density", "compact", { mailListDensity: "compact" });
  const width = screen.getByLabelText("Conversation list width (%)");
  for (const value of ["", "0", "100", "34"]) {
    fireEvent.change(width, { target: { value } });
    fireEvent.blur(width);
  }
  expect(api.updateWorkspaceSettings).toHaveBeenCalledTimes(2);
  fireEvent.change(width, { target: { value: "45.5" } });
  fireEvent.blur(width);
  await waitFor(() =>
    expect(api.updateWorkspaceSettings).toHaveBeenLastCalledWith(
      "mail",
      expect.objectContaining({ preferences: { mailListWidth: 45.5 } }),
    ),
  );
});
it("saves Finance view and grouping preferences", async () => {
  const user = await show("finances");
  await select(user, "Transaction view", "cards", { financeTransactionView: "cards" });
  await select(user, "Group cards by", "category", { financeTransactionGroup: "category" });
});
it("saves Task sorting and toggles individual row details without losing siblings", async () => {
  const user = await show("tasks");
  await select(user, "Sort by", "priority", { taskSort: "priority" });
  await select(user, "Group by", "project", { taskGroup: "project" });
  await select(user, "List and project sorting", "name", { taskContainerSort: "name" });
  await user.click(screen.getByRole("checkbox", { name: "Notes" }));
  await waitFor(() =>
    expect(api.updateWorkspaceSettings).toHaveBeenLastCalledWith(
      "tasks",
      expect.objectContaining({ preferences: { taskRowDetails: ["estimate", "notes"] } }),
    ),
  );
  await waitFor(() => expect(screen.getByRole("checkbox", { name: "Estimates" })).toBeEnabled());
  await user.click(screen.getByRole("checkbox", { name: "Estimates" }));
  await waitFor(() =>
    expect(api.updateWorkspaceSettings).toHaveBeenLastCalledWith(
      "tasks",
      expect.objectContaining({ preferences: { taskRowDetails: ["notes"] } }),
    ),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("switch", { name: "Include completed and archived items in search" }),
    ).toBeEnabled(),
  );
  await user.click(
    screen.getByRole("switch", { name: "Include completed and archived items in search" }),
  );
  await waitFor(() =>
    expect(api.updateWorkspaceSettings).toHaveBeenLastCalledWith(
      "tasks",
      expect.objectContaining({ preferences: { includeArchivedInSearch: false } }),
    ),
  );
});
it("recovers authoritative settings after a rejected write", async () => {
  vi.mocked(api.updateWorkspaceSettings).mockRejectedValueOnce(new Error("Revision conflict"));
  const user = await show("finances");
  await user.selectOptions(screen.getByLabelText("Transaction view"), "cards");
  await waitFor(() =>
    expect(vi.mocked(api.getWorkspaceSettings).mock.calls.length).toBeGreaterThan(1),
  );
  await waitFor(() => expect(screen.getByLabelText("Transaction view")).toHaveValue("table"));
  expect(screen.getByText("Your change: cards")).toBeInTheDocument();
  expect(screen.getByLabelText("Transaction view")).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Refresh latest settings" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Use latest settings" })).toBeEnabled(),
  );
  expect(screen.getByText("Latest: table")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Use latest settings" }));
  await select(user, "Transaction view", "cards", { financeTransactionView: "cards" });
});

it("saves Calendar week start and duration and ignores invalid duration", async () => {
  const user = await show("calendar");
  await select(user, "Week starts on", "monday", { weekStartsOn: "monday" });
  const input = screen.getByLabelText("Default event duration (minutes)");
  for (const value of ["", "0", "1441", "60"]) {
    fireEvent.change(input, { target: { value } });
    fireEvent.blur(input);
  }
  expect(api.updateWorkspaceSettings).toHaveBeenCalledTimes(1);
  fireEvent.change(input, { target: { value: "90" } });
  fireEvent.blur(input);
  await waitFor(() =>
    expect(api.updateWorkspaceSettings).toHaveBeenLastCalledWith(
      "calendar",
      expect.objectContaining({ preferences: { defaultEventDurationMinutes: 90 } }),
    ),
  );
});
it("saves Tasks completed visibility and explicitly resets a stale capture destination", async () => {
  const id = "00000000-0000-4000-8000-000000000124";
  vi.mocked(api.getWorkspaceSettings).mockResolvedValueOnce(
    resolveWorkspaceSettings("tasks", { defaultCaptureListId: id }),
  );
  const user = await show("tasks");
  await waitFor(() => expect(screen.getByLabelText("Default capture list")).toBeEnabled());
  expect(
    screen.getByRole("option", { name: "Unavailable list — new tasks use Inbox" }),
  ).toBeInTheDocument();
  await select(user, "Default capture list", "", { defaultCaptureListId: null });
  await user.click(
    screen.getByRole("switch", { name: "Show completed tasks in lists and projects" }),
  );
  await waitFor(() =>
    expect(api.updateWorkspaceSettings).toHaveBeenLastCalledWith(
      "tasks",
      expect.objectContaining({ preferences: { showCompletedTasks: true } }),
    ),
  );
});
