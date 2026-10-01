// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AccountOverview } from "./account-overview";

const mocks = vi.hoisted(() => ({
  listConnectors: vi.fn(),
  getXBookmarkAccount: vi.fn(),
  getIloSetup: vi.fn(),
  listAgentAccessWorkItems: vi.fn(),
}));
vi.mock("../../api.js", () => ({ api: mocks, errorMessage: (e: Error) => e.message }));
function mount() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <TooltipProvider>
          <AccountOverview />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  mocks.listConnectors.mockResolvedValue([]);
  mocks.getXBookmarkAccount.mockResolvedValue(null);
  mocks.getIloSetup.mockResolvedValue({ status: "complete", steps: [] });
  mocks.listAgentAccessWorkItems.mockResolvedValue({
    unavailableDomains: [],
    summary: { byDomain: { calendar: 0, tasks: 2, mail: 0, finances: 0 } },
  });
});
it("shows live workspace counts and honest empty connections", async () => {
  mount();
  expect(await screen.findByText("2 items need your attention")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Review attention" })).toHaveAttribute(
    "href",
    "/settings?section=reviews&workspace=tasks",
  );
  expect(await screen.findByText("No accounts connected yet.")).toBeInTheDocument();
  for (const workspace of ["Calendar", "Tasks", "Mail", "Finances"]) {
    expect(screen.getByRole("link", { name: `Open ${workspace} settings` })).toHaveAttribute(
      "href",
      `/settings?section=${workspace.toLowerCase()}`,
    );
  }
  expect(screen.queryByRole("link", { name: "Open Today at a Glance" })).not.toBeInTheDocument();
});
it("surfaces setup actions and unavailable domains without claiming all clear", async () => {
  mocks.getIloSetup.mockImplementation(({ domain }) =>
    Promise.resolve(
      domain === "mail"
        ? { status: "in_progress", currentStepId: "one", steps: [{ id: "one", owner: "person" }] }
        : { status: "complete", steps: [] },
    ),
  );
  mocks.listAgentAccessWorkItems.mockResolvedValue({
    unavailableDomains: ["calendar"],
    summary: { byDomain: { calendar: 0, tasks: 0, mail: 0, finances: 0 } },
  });
  mocks.listConnectors.mockRejectedValue(new Error("Unavailable"));
  mount();
  expect(await screen.findByText("Setup needs your attention")).toBeInTheDocument();
  expect(await screen.findByText("Attention status unavailable")).toBeInTheDocument();
  expect(await screen.findByText("Couldn’t check connected accounts.")).toBeInTheDocument();
  expect(screen.queryByText("No accounts connected yet.")).not.toBeInTheDocument();
});

it("surfaces provider reconnection errors beside the affected account", async () => {
  mocks.listConnectors.mockResolvedValue([
    {
      id: "provider",
      label: "Personal Google",
      email: "demo@example.com",
      health: { state: "reconnect" },
    },
  ]);
  mount();
  expect(await screen.findByText("Reconnect required")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Manage Personal Google" })).toHaveAttribute(
    "href",
    "/settings?section=connections",
  );
});
