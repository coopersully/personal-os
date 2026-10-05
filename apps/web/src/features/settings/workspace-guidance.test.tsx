// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspaceGuidance } from "./workspace-guidance";

const mocks = vi.hoisted(() => ({ getDomainProfile: vi.fn(), upsertDomainProfile: vi.fn() }));
vi.mock("../../api.js", () => ({ api: mocks, errorMessage: (error: Error) => error.message }));
const profile = {
  domain: "tasks",
  version: 3,
  objective: "Keep commitments manageable",
  instructions: ["Protect focus"],
  categories: [{ name: "Work" }],
  preferences: { preserve: true },
  sourceContexts: [{ source: "manual" }],
  status: "active",
  summary: "Existing approved guidance",
};
function mount() {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cache}>
      <WorkspaceGuidance domain="tasks" />
    </QueryClientProvider>,
  );
  return cache;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDomainProfile.mockResolvedValue(profile);
  mocks.upsertDomainProfile.mockImplementation(async (input) => ({ ...input, version: 4 }));
});
it("saves a versioned edit without dropping unrelated preferences and normalizes the saved draft", async () => {
  const user = userEvent.setup();
  mount();
  const objective = await screen.findByRole("textbox", { name: "Objective" });
  expect(screen.getByRole("button", { name: "Save guidance" })).toBeDisabled();
  await user.clear(objective);
  await user.type(objective, "  Fewer commitments  ");
  await user.click(screen.getByRole("button", { name: "Save guidance" }));
  await waitFor(() =>
    expect(mocks.upsertDomainProfile).toHaveBeenCalledWith({
      domain: "tasks",
      expectedVersion: 3,
      objective: "Fewer commitments",
      instructions: profile.instructions,
      categories: profile.categories,
      preferences: profile.preferences,
      sourceContexts: profile.sourceContexts,
      status: profile.status,
      summary: profile.summary,
    }),
  );
  await waitFor(() => expect(objective).toHaveValue("Fewer commitments"));
  expect(screen.getByRole("button", { name: "Save guidance" })).toBeDisabled();
});
it("keeps drafts on failed writes and explicitly reloads the latest version", async () => {
  mocks.upsertDomainProfile.mockRejectedValue(new Error("Version conflict"));
  const user = userEvent.setup();
  mount();
  const objective = await screen.findByRole("textbox", { name: "Objective" });
  await user.clear(objective);
  await user.type(objective, "My unsaved draft");
  await user.click(screen.getByRole("button", { name: "Save guidance" }));
  const reload = await screen.findByRole("button", { name: "Discard draft and reload" });
  expect(objective).toHaveValue("My unsaved draft");
  mocks.getDomainProfile.mockResolvedValue({
    ...profile,
    version: 9,
    objective: "Updated elsewhere",
  });
  await user.click(reload);
  await waitFor(() => expect(objective).toHaveValue("Updated elsewhere"));
  await user.type(objective, " again");
  await user.click(screen.getByRole("button", { name: "Save guidance" }));
  await waitFor(() =>
    expect(mocks.upsertDomainProfile).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedVersion: 9 }),
    ),
  );
});
it("distinguishes missing configuration from unavailable data", async () => {
  mocks.getDomainProfile.mockResolvedValue(null);
  mount();
  expect(await screen.findByText(/No guidance has been configured yet/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Save guidance" })).not.toBeInTheDocument();
});
