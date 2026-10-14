// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ReviewNavigation, TodayReviewNavigation } from "./navigation.js";

const mocks = vi.hoisted(() => ({ listAgentAccessWorkItems: vi.fn() }));
vi.mock("../../api.js", () => ({ api: mocks }));
function renderEntry(
  workspace: "calendar" | "tasks" | "mail" | "finances" = "calendar",
  footer = false,
) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={["/calendar/decisions"]}>
        <ReviewNavigation workspace={workspace} footer={footer} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
it.each([
  [1, "1 item needs review"],
  [3, "3 items need review"],
  [1200, "1,200 items need review"],
])("shows an honest count of %s", async (count, label) => {
  mocks.listAgentAccessWorkItems.mockResolvedValue({
    summary: { byDomain: { calendar: count } },
    unavailableDomains: [],
  });
  renderEntry();
  const link = await screen.findByRole("button", { name: label as string });
  expect(link.querySelector(".review-navigation__count")).toHaveTextContent(
    count === 1200 ? "1.2k" : String(count),
  );
  if (count) expect(link).toHaveAttribute("data-attention", "true");
  else expect(link).not.toHaveAttribute("data-attention");
});
it("surfaces failed counts instead of claiming there is no work", async () => {
  mocks.listAgentAccessWorkItems.mockRejectedValue(new Error("Unavailable"));
  renderEntry();
  const button = await screen.findByRole("button", { name: "Reviews" });
  expect(button).not.toHaveAttribute("data-attention");
  expect(button.querySelector(".review-navigation__count")).toHaveTextContent("—");
});

it.each([
  "calendar",
  "tasks",
  "mail",
  "finances",
] as const)("hides zero-count entry points for %s", async (workspace) => {
  mocks.listAgentAccessWorkItems.mockResolvedValue({
    summary: { byDomain: { [workspace]: 0 } },
    unavailableDomains: [],
  });
  renderEntry(workspace);
  await waitFor(() => expect(screen.queryByRole("button")).not.toBeInTheDocument());
});
function LocationProbe() {
  return <output aria-label="Review location">{useLocation().search}</output>;
}
it("opens footer reviews without losing the active calendar filters", async () => {
  mocks.listAgentAccessWorkItems.mockResolvedValue({
    summary: { byDomain: { calendar: 2 } },
    unavailableDomains: [],
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={["/calendar?view=week&calendar=chosen&review=attention:one"]}>
        <TooltipProvider>
          <SidebarProvider>
            <ReviewNavigation workspace="calendar" footer />
          </SidebarProvider>
        </TooltipProvider>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await userEvent.click(await screen.findByRole("button", { name: "2 items need review" }));
  expect(screen.getByLabelText("Review location")).toHaveTextContent(
    "?view=week&calendar=chosen&review=open",
  );
});
it("marks an unavailable domain honestly even when a stale count remains", async () => {
  mocks.listAgentAccessWorkItems.mockResolvedValue({
    summary: { byDomain: { calendar: 3 } },
    unavailableDomains: ["calendar"],
  });
  renderEntry();
  const button = await screen.findByRole("button", { name: "Reviews" });
  expect(button).not.toHaveAttribute("data-attention");
  expect(button.querySelector(".review-navigation__count")).toHaveTextContent("—");
  expect(screen.queryByRole("button", { name: "3 items need review" })).not.toBeInTheDocument();
});

it("Today shows the aggregate review count and links each workspace to its existing flow", async () => {
  mocks.listAgentAccessWorkItems.mockResolvedValue({
    summary: { total: 23, byDomain: { calendar: 20, tasks: 0, mail: 3, finances: 0 } },
    unavailableDomains: [],
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={["/today"]}>
        <TodayReviewNavigation />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await userEvent.click(await screen.findByRole("button", { name: "23 items need review" }));
  expect(await screen.findByRole("menuitem", { name: /Calendar/ })).toHaveAttribute(
    "href",
    "/calendar?review=open",
  );
  expect(screen.getByRole("menuitem", { name: /Mail/ })).toHaveAttribute(
    "href",
    "/mail?review=open",
  );
  expect(screen.queryByRole("menuitem", { name: /Tasks/ })).not.toBeInTheDocument();
});
it("Today exposes uncertain review sources without claiming zero work", async () => {
  mocks.listAgentAccessWorkItems.mockRejectedValue(new Error("unavailable"));
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <TodayReviewNavigation />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await userEvent.click(await screen.findByRole("button", { name: "Reviews" }));
  expect(await screen.findAllByRole("menuitem")).toHaveLength(4);
});
