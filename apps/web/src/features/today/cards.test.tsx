// @vitest-environment jsdom
import { getDefaultWorkspacePreferences, type RitualState } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/api";
import * as desktop from "@/features/desktop/bridge";
import * as ritual from "@/features/desktop/ritual-bridge";
import { TodayAttention } from "./attention";
import { TodayPetCard } from "./pet-card";
import { TodayRitualCard } from "./ritual-card";
import { TodaySpendingCard } from "./spending-card";

const state: RitualState = {
  definitions: [],
  current: null,
  serverNow: "2026-10-14T16:00:00Z",
  snoozeCount: 0,
  syncStatus: "saved",
};
function setup(child: React.ReactNode) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cache.setQueryData(["me"], { id: "owner" });
  const view = render(
    <MemoryRouter>
      <QueryClientProvider client={cache}>{child}</QueryClientProvider>
    </MemoryRouter>,
  );
  return { ...view, cache };
}
beforeEach(() => {
  vi.spyOn(api, "getXBookmarkAccount").mockResolvedValue(null);
});
afterEach(() => vi.restoreAllMocks());
it("does not read native settings on the web", () => {
  vi.spyOn(desktop, "isDesktop").mockReturnValue(false);
  const read = vi.spyOn(desktop, "getDesktopSettings");
  setup(<TodayPetCard />);
  expect(read).not.toHaveBeenCalled();
  expect(screen.queryByText("Your desktop pet")).not.toBeInTheDocument();
});
it("opens the existing pet command and delivers native failures through Sonner only", async () => {
  vi.spyOn(desktop, "isDesktop").mockReturnValue(true);
  vi.spyOn(desktop, "getDesktopSettings").mockResolvedValue({
    settings: { petEnabled: true },
  } as Awaited<ReturnType<typeof desktop.getDesktopSettings>>);
  const action = vi
    .spyOn(desktop, "nativeAction")
    .mockRejectedValue(new Error("native unavailable"));
  const feedback = vi.spyOn(toast, "promise").mockImplementation((promise) => {
    if (promise instanceof Promise) void promise.catch(() => {});
    return { unwrap: () => Promise.resolve() };
  });
  setup(<TodayPetCard />);
  await userEvent.click(await screen.findByRole("button", { name: "Open quick access" }));
  expect(action).toHaveBeenCalledWith("quick_access");
  expect(feedback).toHaveBeenCalled();
  expect(screen.queryByText("Could not open pet quick access.")).not.toBeInTheDocument();
  await action.mock.results[0]?.value.catch(() => {});
});
it.each([
  null,
  [],
  ["selected-account"],
])("uses Finance selection %j and ends spending at today", async (accountIds) => {
  vi.spyOn(api, "getWorkspaceSettings").mockImplementation(
    async (workspace) =>
      ({
        workspace,
        revision: 1,
        preferences: {
          ...getDefaultWorkspacePreferences(workspace),
          ...(workspace === "finances"
            ? { spendAccountIds: accountIds }
            : { weekStartsOn: "monday" }),
        },
      }) as Awaited<ReturnType<typeof api.getWorkspaceSettings>>,
  );
  const position = vi
    .spyOn(api, "getFinancePosition")
    .mockResolvedValue({ postedSpend: { cents: null, quality: "unavailable" } } as Awaited<
      ReturnType<typeof api.getFinancePosition>
    >);
  setup(
    <TodaySpendingCard
      now={new Date("2026-10-14T16:00:00Z")}
      timeZone="America/New_York"
      window="week"
    />,
  );
  await waitFor(() =>
    expect(position).toHaveBeenCalledWith({
      from: "2026-10-12",
      through: "2026-10-14",
      ...(accountIds === null ? {} : { accountIds }),
    }),
  );
  expect(await screen.findByText("Unavailable")).toBeInTheDocument();
  expect(screen.queryByText("$0.00")).not.toBeInTheDocument();
});
it("renders no current ritual honestly without calling a native launch", async () => {
  vi.spyOn(ritual, "readRitualState").mockResolvedValue(state);
  const open = vi.spyOn(ritual, "openCurrentRitual");
  setup(<TodayRitualCard />);
  expect(await screen.findByText("No current ritual")).toBeInTheDocument();
  expect(open).not.toHaveBeenCalled();
});
it("keeps connection failures independent of review navigation", async () => {
  vi.spyOn(api, "listConnectors").mockRejectedValue(new Error("unavailable"));
  vi.spyOn(api, "getFinanceStatus").mockRejectedValue(new Error("unavailable"));
  const feedback = vi.spyOn(toast, "error");
  const { container } = setup(<TodayAttention />);
  await waitFor(() =>
    expect(feedback).toHaveBeenCalledWith("Couldn’t check connections.", expect.any(Object)),
  );
  expect(container).toBeEmptyDOMElement();
  expect(screen.queryByText("Some connections could not be checked")).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: /Open calendar attention/ })).not.toBeInTheDocument();
});

it("retains spending geometry after a failed refresh and sends the error through Sonner", async () => {
  vi.spyOn(api, "getWorkspaceSettings").mockImplementation(
    async (workspace) =>
      ({
        workspace,
        revision: 1,
        preferences: getDefaultWorkspacePreferences(workspace),
      }) as Awaited<ReturnType<typeof api.getWorkspaceSettings>>,
  );
  const read = vi
    .spyOn(api, "getFinancePosition")
    .mockResolvedValue({ postedSpend: { cents: 1250, quality: "qualified" } } as Awaited<
      ReturnType<typeof api.getFinancePosition>
    >);
  const feedback = vi.spyOn(toast, "error");
  const { cache, container } = setup(
    <TodaySpendingCard
      now={new Date("2026-10-14T16:00:00Z")}
      timeZone="America/New_York"
      window="week"
    />,
  );
  await screen.findByText("$12.50");
  const before = container.querySelector('[data-slot="card-content"]')?.childElementCount;
  read.mockRejectedValue(new Error("unavailable"));
  await act(async () => {
    await cache.refetchQueries({ queryKey: ["today-spending"] });
  });
  await waitFor(() =>
    expect(feedback).toHaveBeenCalledWith("Couldn’t refresh spending.", expect.any(Object)),
  );
  expect(screen.getByText("$12.50")).toBeVisible();
  expect(screen.queryByText("Could not refresh this amount.")).not.toBeInTheDocument();
  expect(container.querySelector('[data-slot="card-content"]')?.childElementCount).toBe(before);
  expect(container.querySelector('[role="alert"], [role="status"]')).toBeNull();
});
