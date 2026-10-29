// @vitest-environment jsdom
import { type FinanceConfiguration, financeConfigurationCapabilities } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { financeConfigurationKey, useFinanceProfileField } from "./use-finance-configuration.js";

const api = vi.hoisted(() => ({ updateFinancialProfile: vi.fn() }));
vi.mock("../../api.js", () => ({ api, errorMessage: (error: Error) => error.message }));

function field() {
  api.updateFinancialProfile.mockReset().mockReturnValue(new Promise(() => {}));
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  client.setQueryData<FinanceConfiguration>(financeConfigurationKey, {
    profile: { state: "loaded", value: null },
    preferences: { state: "unavailable" },
    income: { state: "unavailable" },
    accounts: { state: "unavailable" },
    budget: { state: "unavailable" },
    guidance: { state: "unavailable" },
    execution: { state: "unavailable" },
    capabilities: financeConfigurationCapabilities({ state: "unavailable" }),
  });
  return renderHook(
    () =>
      useFinanceProfileField<string | null>("householdSize", "3", (value) => ({
        householdSize: value ? Number(value) : null,
      })),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
}

it.each([
  "",
  null,
])("commits a cleared draft before observer rerender and deduplicates pending saves (%j)", async (cleared) => {
  const { result } = field();
  const beforeRender = result.current;
  act(() => {
    beforeRender.setValue(cleared);
    beforeRender.commit();
    beforeRender.commit();
  });
  await waitFor(() => expect(api.updateFinancialProfile).toHaveBeenCalledTimes(1));
  expect(api.updateFinancialProfile).toHaveBeenCalledWith(
    expect.objectContaining({
      changes: { householdSize: null },
      expectedVersion: 0,
    }),
  );
});

it("preserves an explicit submitted value instead of replacing it with the draft", async () => {
  const { result } = field();
  act(() => {
    result.current.setValue("");
    result.current.commit("4");
  });
  await waitFor(() => expect(api.updateFinancialProfile).toHaveBeenCalledTimes(1));
  expect(api.updateFinancialProfile).toHaveBeenCalledWith(
    expect.objectContaining({ changes: { householdSize: 4 } }),
  );
});
