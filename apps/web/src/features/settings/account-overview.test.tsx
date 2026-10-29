// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AccountOverview } from "./account-overview";

const mocks = vi.hoisted(() => ({
  listConnectors: vi.fn(),
  getXBookmarkAccount: vi.fn(),
  getPersonalOsSetup: vi.fn(),
  listAgentAccessWorkItems: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), dismiss: vi.fn() } }));
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
  mocks.getPersonalOsSetup.mockResolvedValue({ status: "complete", steps: [] });
  mocks.listAgentAccessWorkItems.mockResolvedValue({
    unavailableDomains: [],
    summary: { byDomain: { calendar: 0, tasks: 2, mail: 0, finances: 0 } },
  });
});
it("shows live workspace counts and honest empty connections", async () => {
  mount();
  expect(await screen.findByText("2 pending")).toBeInTheDocument();
  expect(await screen.findByRole("link", { name: "Manage connections" })).toBeInTheDocument();
  for (const workspace of ["Calendar", "Tasks", "Mail", "Finances"]) {
    expect(screen.getByRole("link", { name: workspace })).toHaveAttribute(
      "href",
      `/settings?page=${workspace.toLowerCase()}`,
    );
  }
  expect(screen.queryByRole("link", { name: / reviews$/ })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Tasks" })).toHaveTextContent("2 pending");
  expect(
    screen.queryByRole("status", { name: "Calendar: Action required" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Continue setup" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Open Today at a Glance" })).not.toBeInTheDocument();
});
it("surfaces setup actions and unavailable domains without claiming all clear", async () => {
  mocks.getPersonalOsSetup.mockImplementation(({ domain }) =>
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
  expect(await screen.findByText("Setup needed")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Mail" })).toHaveTextContent("Setup needed");
  expect(await screen.findByText("Unavailable")).toBeInTheDocument();
  await screen.findByRole("region", { name: "Connections unavailable" });
  expect(toast.error).toHaveBeenCalledWith(
    "Couldn’t check connected accounts.",
    expect.any(Object),
  );
  expect(screen.queryByText("Couldn’t check connected accounts.")).not.toBeInTheDocument();
  expect(screen.queryByText("No accounts connected yet.")).not.toBeInTheDocument();
});

it("surfaces provider reconnection errors beside the affected account", async () => {
  mocks.listConnectors.mockResolvedValue([
    {
      id: "provider",
      label: "Personal Google",
      provider: "google",
      email: "demo@example.com",
      health: { state: "reconnect" },
    },
  ]);
  mount();
  expect(await screen.findByText("Reconnect required")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Personal Google" })).toHaveAttribute(
    "href",
    "/settings?page=connections",
  );
});
