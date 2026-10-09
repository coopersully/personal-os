// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { TaskContainerPin } from "./container-pins";

const mocks = vi.hoisted(() => ({
  getWorkspaceSettings: vi.fn(),
  updateWorkspaceSettings: vi.fn(),
}));
vi.mock("@/api", () => ({ api: mocks }));

it("serializes pins from different controls and lets archived items be unpinned", async () => {
  let settings = {
    workspace: "tasks",
    revision: 0,
    preferences: { pinnedListIds: [] as string[] },
  };
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  mocks.getWorkspaceSettings.mockImplementation(async () => settings);
  mocks.updateWorkspaceSettings.mockImplementation(async (_workspace, input) => {
    if (input.expectedRevision === 0) await pending;
    expect(input.expectedRevision).toBe(settings.revision);
    settings = { ...settings, revision: settings.revision + 1, preferences: input.preferences };
    return settings;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["me"], { id: "owner" });
  const controls = (archived = false) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TaskContainerPin id="one" kind="list" name="First" unpinOnly={archived} />
        <TaskContainerPin id="two" kind="list" name="Second" />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(controls());
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByRole("button", { name: "Pin First" })).toBeEnabled());
  await user.click(screen.getByRole("button", { name: "Pin First" }));
  await user.click(screen.getByRole("button", { name: "Pin Second" }));
  expect(mocks.updateWorkspaceSettings).toHaveBeenCalledTimes(1);
  await act(async () => release());
  await waitFor(() => expect(settings.preferences.pinnedListIds).toEqual(["one", "two"]));
  view.rerender(controls(true));
  await user.click(screen.getByRole("button", { name: "Unpin First" }));
  await waitFor(() => expect(settings.preferences.pinnedListIds).toEqual(["two"]));
  expect(screen.queryByRole("button", { name: "Pin First" })).not.toBeInTheDocument();
});

it("keeps a failed pin reachable through Settings without silently retrying", async () => {
  mocks.getWorkspaceSettings.mockResolvedValue({
    workspace: "tasks",
    revision: 0,
    preferences: { pinnedListIds: [] },
  });
  mocks.updateWorkspaceSettings.mockRejectedValue(new Error("Offline"));
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cache.setQueryData(["me"], { id: "owner" });
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter>
        <TaskContainerPin id="one" kind="list" name="First" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByRole("button", { name: "Pin First" })).toBeEnabled());
  await userEvent.click(screen.getByRole("button", { name: "Pin First" }));
  expect(
    await screen.findByRole("link", { name: "Review unsaved pin preferences" }),
  ).toHaveAttribute("href", "/settings?section=tasks");
  expect(screen.getByRole("button", { name: "Pin First" })).toBeDisabled();
});
