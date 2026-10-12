// @vitest-environment jsdom
import { financesWorkspacePreferencesSchema } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspacePreferencesSection } from "../workspace-settings/section";

const api = vi.hoisted(() => ({ getWorkspaceSettings: vi.fn(), updateWorkspaceSettings: vi.fn() }));
vi.mock("@/api", () => ({ api, errorMessage: (error: Error) => error.message }));

it("edits transaction defaults in Finance settings while preserving the other preference", async () => {
  const saved = {
    workspace: "finances",
    revision: 5,
    preferences: financesWorkspacePreferencesSchema.parse({
      financeTransactionView: "cards",
      financeTransactionGroup: "merchant",
    }),
  };
  api.getWorkspaceSettings.mockResolvedValue(saved);
  api.updateWorkspaceSettings.mockImplementation(async (_workspace, input) => ({
    ...saved,
    revision: 6,
    preferences: { ...saved.preferences, ...input.preferences },
  }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["me"], { id: "owner" });
  render(
    <QueryClientProvider client={client}>
      <WorkspacePreferencesSection workspace="finances" />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByLabelText("Transaction view")).toHaveValue("cards"));
  expect(screen.getByLabelText("Group cards by")).toHaveValue("merchant");
  await userEvent.selectOptions(screen.getByLabelText("Transaction view"), "table");
  await waitFor(() =>
    expect(api.updateWorkspaceSettings).toHaveBeenCalledWith("finances", {
      expectedRevision: 5,
      preferences: { financeTransactionView: "table" },
    }),
  );
  await waitFor(() => expect(screen.getByLabelText("Transaction view")).toHaveValue("table"));
  expect(screen.getByLabelText("Group cards by")).toHaveValue("merchant");
});
