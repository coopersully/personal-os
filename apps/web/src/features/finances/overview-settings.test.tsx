// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { ApiClientError } from "@personal-os/api-client";
import { type FinanceConfiguration, resolveWorkspaceSettings } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { api } from "@/api";
import { useSaveWorkspacePreferences } from "../workspace-settings/preferences";
import { FinanceOverviewSettings } from "./overview-settings";

const configuration = (name = "Everyday checking") =>
  ({
    accounts: {
      state: "loaded",
      value: { accounts: [{ id: "checking", name, kind: "cash", balance: 20 }] },
    },
  }) as unknown as FinanceConfiguration;
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function OtherWriter() {
  const save = useSaveWorkspacePreferences("finances");
  return (
    <button type="button" onClick={() => save.mutate({ cashAccountIds: [] })}>
      Other writer
    </button>
  );
}
function mount(otherWriter = false) {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  cache.setQueryData(["me"], { id: "A" });
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter>
        {otherWriter ? <OtherWriter /> : null}
        <FinanceOverviewSettings />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return cache;
}
it("opens truthful view selections without a snapshot, retains conflict after reopening and refreshes without writing", async () => {
  const saved = resolveWorkspaceSettings("finances", {
    spendAccountIds: ["checking"],
    revision: 4,
  });
  vi.spyOn(api, "getFinanceConfiguration").mockResolvedValue(configuration());
  vi.spyOn(api, "getWorkspaceSettings").mockResolvedValue(saved);
  const update = vi
    .spyOn(api, "updateWorkspaceSettings")
    .mockRejectedValue(new ApiClientError({ status: 409, code: "conflict", message: "Changed" }));
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Workspace view settings" }));
  expect(screen.getByText(/do not change the financial position totals/)).toBeVisible();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Spending account view selections" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Spending account view selections" }));
  fireEvent.click(screen.getByLabelText("Everyday checking"));
  await screen.findByText("Your change: None selected");
  fireEvent.click(screen.getByRole("button", { name: "Refresh latest settings" }));
  await screen.findByText("Latest: Everyday checking");
  expect(update).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Review unsaved account selections" }));
  expect(screen.getByText("Your change: None selected")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Reapply reviewed change" }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
  expect(update).toHaveBeenLastCalledWith(
    "finances",
    expect.objectContaining({ expectedRevision: 4, preferences: { spendAccountIds: [] } }),
  );
  expect(screen.getByText("Your change: None selected")).toBeVisible();
});
it("fences deferred account names through A to B to A and requires fresh expansion", async () => {
  let release!: (value: FinanceConfiguration) => void;
  vi.spyOn(api, "getWorkspaceSettings").mockResolvedValue(resolveWorkspaceSettings("finances"));
  const load = vi
    .spyOn(api, "getFinanceConfiguration")
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    )
    .mockResolvedValue(configuration("Current checking"));
  const cache = mount();
  fireEvent.click(screen.getByRole("button", { name: "Workspace view settings" }));
  await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  act(() => {
    cache.setQueryData(["me"], { id: "B" });
    cache.setQueryData(["me"], { id: "A" });
  });
  await act(async () => release(configuration("Old account name")));
  expect(screen.queryByText("Old account name")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Workspace view settings" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  fireEvent.click(screen.getByRole("button", { name: "Workspace view settings" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Spending account view selections" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Spending account view selections" }));
  expect(screen.getByLabelText("Current checking")).toBeChecked();
});

it("discovers another hook's retained attempt without opening view settings first", async () => {
  vi.spyOn(api, "getFinanceConfiguration").mockResolvedValue(configuration());
  vi.spyOn(api, "getWorkspaceSettings").mockResolvedValue(
    resolveWorkspaceSettings("finances", { cashAccountIds: ["checking"], revision: 2 }),
  );
  const update = vi
    .spyOn(api, "updateWorkspaceSettings")
    .mockRejectedValue(new ApiClientError({ status: 409, code: "conflict", message: "Changed" }));
  mount(true);
  fireEvent.click(screen.getByRole("button", { name: "Other writer" }));
  await screen.findByText("Your change: None selected");
  expect(screen.getByRole("link", { name: "Open Finance settings" })).toHaveAttribute(
    "href",
    "/settings?section=finances",
  );
  fireEvent.click(screen.getByRole("button", { name: "Refresh latest settings" }));
  await screen.findByText("Latest: Everyday checking");
  expect(update).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Use latest settings" }));
  await waitFor(() =>
    expect(screen.queryByText("Your change: None selected")).not.toBeInTheDocument(),
  );
});

it("reloads unavailable account names in retained recovery without saving until explicit replay", async () => {
  const load = vi
    .spyOn(api, "getFinanceConfiguration")
    .mockResolvedValueOnce({
      accounts: { state: "unavailable" },
    } as unknown as FinanceConfiguration)
    .mockResolvedValue(configuration());
  vi.spyOn(api, "getWorkspaceSettings").mockResolvedValue(
    resolveWorkspaceSettings("finances", { cashAccountIds: ["checking"], revision: 6 }),
  );
  const update = vi
    .spyOn(api, "updateWorkspaceSettings")
    .mockRejectedValue(new ApiClientError({ status: 409, code: "conflict", message: "Changed" }));
  mount(true);
  fireEvent.click(screen.getByRole("button", { name: "Other writer" }));
  await screen.findByText("Your change: None selected");
  await screen.findByRole("button", { name: "Reload account names" });
  fireEvent.click(screen.getByRole("button", { name: "Refresh latest settings" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Reapply reviewed change" })).toBeDisabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Reload account names" }));
  await screen.findByText("Latest: Everyday checking");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Reapply reviewed change" })).toBeEnabled(),
  );
  expect(load).toHaveBeenCalledTimes(2);
  expect(update).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Reapply reviewed change" }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
  expect(update).toHaveBeenLastCalledWith(
    "finances",
    expect.objectContaining({ expectedRevision: 6, preferences: { cashAccountIds: [] } }),
  );
});
