// @vitest-environment jsdom
import { resolveTodaySettings } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { api } from "@/api";
import { TodaySettingsPage } from "./settings";

afterEach(() => vi.restoreAllMocks());
it("offers three backgrounds and persists only the selected preference", async () => {
  let settings = resolveTodaySettings(null);
  vi.spyOn(api, "getTodaySettings").mockImplementation(async () => settings);
  const update = vi.spyOn(api, "updateTodaySettings").mockImplementation(async (input) => {
    settings = resolveTodaySettings({
      ...settings.preferences,
      ...Object.fromEntries(
        Object.entries(input.preferences).filter(([, value]) => value !== undefined),
      ),
      revision: 1,
    });
    return settings;
  });
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cache.setQueryData(["me"], { id: "owner" });
  render(
    <MemoryRouter>
      <QueryClientProvider client={cache}>
        <TodaySettingsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const weather = await screen.findByRole("radio", { name: "Weather" });
  await waitFor(() => expect(weather).not.toBeDisabled());
  await userEvent.click(weather);
  await waitFor(() =>
    expect(update).toHaveBeenCalledWith({
      expectedRevision: 0,
      preferences: { background: "weather" },
    }),
  );
  expect(screen.getByRole("radio", { name: "Default" })).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "Map" })).toBeInTheDocument();
  expect(screen.getByRole("switch", { name: "Spending" })).not.toBeChecked();
});
