// @vitest-environment jsdom
import { type FinanceConfiguration, financeConfigurationCapabilities } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FinanceIncomeEditor } from "./configuration-income.js";
import { financeConfigurationKey } from "./use-finance-configuration.js";

const api = vi.hoisted(() => ({ getFinanceConfiguration: vi.fn(), updateFinanceProfile: vi.fn() }));
vi.mock("../../api.js", () => ({ api, errorMessage: (error: Error) => error.message }));

it("saves an immediate payroll edit and blur before the draft observer rerenders", async () => {
  const config: FinanceConfiguration = {
    profile: { state: "loaded", value: null },
    income: { state: "loaded", value: null },
    preferences: { state: "unavailable" },
    accounts: { state: "unavailable" },
    budget: { state: "unavailable" },
    guidance: { state: "unavailable" },
    execution: { state: "unavailable" },
    capabilities: financeConfigurationCapabilities({ state: "unavailable" }),
  };
  api.getFinanceConfiguration.mockResolvedValue(config);
  api.updateFinanceProfile.mockReturnValue(new Promise(() => {}));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(financeConfigurationKey, config);
  client.setQueryData(["me"], { planningTimezone: "America/New_York" });
  render(
    <QueryClientProvider client={client}>
      <FinanceIncomeEditor />
    </QueryClientProvider>,
  );
  const input = await screen.findByLabelText("Employer");
  act(() => {
    fireEvent.change(input, { target: { value: "Updated employer" } });
    fireEvent.blur(input);
    fireEvent.blur(input);
  });
  await waitFor(() => expect(api.updateFinanceProfile).toHaveBeenCalledTimes(1));
  expect(api.updateFinanceProfile).toHaveBeenCalledWith(
    expect.objectContaining({ employer: "Updated employer", expectedUpdatedAt: null }),
  );
});
