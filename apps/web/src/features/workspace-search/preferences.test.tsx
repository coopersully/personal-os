// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { type SearchableWorkspace, workspacePreferencesSchema } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { api } from "@/api";
import { WorkspacePreferencesSection } from "./preferences";

beforeEach(() => {
  let preferences = workspacePreferencesSchema.parse({});
  let revision = 0;
  vi.spyOn(api, "getWorkspaceSettings").mockImplementation(async (workspace) => ({
    workspace,
    revision,
    preferences,
  }));
  vi.spyOn(api, "updateWorkspaceSettings").mockImplementation(async (workspace, input) => {
    expect(input.expectedRevision).toBe(revision);
    preferences = workspacePreferencesSchema.parse({ ...preferences, ...input.preferences });
    return { workspace, revision: ++revision, preferences };
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
  await waitFor(() => expect(screen.getByRole("switch")).toBeEnabled());
  await user.click(screen.getByRole("switch"));
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
  await waitFor(() => expect(api.getWorkspaceSettings).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByLabelText("Transaction view")).toHaveValue("table"));
  await select(user, "Transaction view", "cards", { financeTransactionView: "cards" });
});
