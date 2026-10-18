// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { financesWorkspacePreferencesSchema } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FinanceManualVisibilitySettings } from "./manual-visibility-settings";

const api = vi.hoisted(() => ({ getWorkspaceSettings: vi.fn(), updateWorkspaceSettings: vi.fn() }));
const toast = vi.hoisted(() => ({
  error: vi.fn(),
  loading: vi.fn(),
  success: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("@/api", () => ({ api, errorMessage: (error: Error) => error.message }));
vi.mock("sonner", () => ({ toast }));
beforeEach(() => vi.clearAllMocks());
function mount() {
  const settings = {
    workspace: "finances",
    revision: 5,
    preferences: financesWorkspacePreferencesSchema.parse({
      financeManualVisibility: "auto",
      financeTransactionView: "cards",
    }),
  };
  api.getWorkspaceSettings.mockResolvedValue(settings);
  api.updateWorkspaceSettings.mockImplementation(async (_workspace, input) => ({
    ...settings,
    revision: 6,
    preferences: { ...settings.preferences, ...input.preferences },
  }));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(["me"], { id: "owner" });
  render(
    <QueryClientProvider client={client}>
      <FinanceManualVisibilitySettings />
    </QueryClientProvider>,
  );
  return client;
}
it("patches only manual visibility with the observed revision and refreshes the shared server projection", async () => {
  const client = mount();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  await waitFor(() => expect(screen.getByLabelText("Manual creation and imports")).toBeEnabled());
  invalidate.mockClear();
  await userEvent.selectOptions(screen.getByLabelText("Manual creation and imports"), "hide");
  await waitFor(() =>
    expect(screen.getByLabelText("Manual creation and imports")).toHaveValue("hide"),
  );
  expect(api.updateWorkspaceSettings).toHaveBeenCalledWith("finances", {
    expectedRevision: 5,
    preferences: { financeManualVisibility: "hide" },
  });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["finance-onboarding"] });
  expect(toast.error).not.toHaveBeenCalled();
  expect(toast.success).not.toHaveBeenCalled();
});
it("keeps the saved choice on a rejected write and uses shared recovery plus Sonner", async () => {
  mount();
  await waitFor(() => expect(screen.getByLabelText("Manual creation and imports")).toBeEnabled());
  api.updateWorkspaceSettings.mockRejectedValue(new Error("Revision conflict"));
  await userEvent.selectOptions(screen.getByLabelText("Manual creation and imports"), "show");
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  expect(screen.getByLabelText("Manual creation and imports")).toHaveValue("auto");
  expect(screen.getByLabelText("Manual creation and imports")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Refresh latest settings" })).toBeEnabled();
  expect(screen.queryByText("Revision conflict")).not.toBeInTheDocument();
  expect(api.updateWorkspaceSettings).toHaveBeenCalledTimes(1);
});
