// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FinanceSidebarNavigation, financeSectionFromPath } from "./navigation.js";

vi.mock("../../api.js", () => ({
  api: {
    getFinanceConfiguration: vi
      .fn()
      .mockResolvedValue({ capabilities: { budget: { state: "needs_input" } } }),
  },
}));

it("maps Finance paths and marks the active navigation item", async () => {
  expect(financeSectionFromPath("/finances")).toBe("overview");
  expect(financeSectionFromPath("/finances/review")).toBe("review");
  expect(financeSectionFromPath("/finances/budgets")).toBe("plan");
  expect(financeSectionFromPath("/finances/wealth")).toBe("wealth");
  expect(financeSectionFromPath("/finances/setup")).toBe("setup");
  expect(financeSectionFromPath("/finances/not-a-section")).toBe("overview");
  const onNavigate = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <TooltipProvider>
          <SidebarProvider>
            <FinanceSidebarNavigation onNavigate={onNavigate} reviewCount={3} section="review" />
          </SidebarProvider>
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(screen.queryByRole("link", { name: /^Review/ })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/finances");
  expect(screen.getByRole("link", { name: "Budget" })).toHaveAttribute("href", "/finances/plan");
  expect(screen.getByRole("link", { name: "Wealth" })).toHaveAttribute("href", "/finances/wealth");
  expect(screen.queryByRole("link", { name: "Finance settings" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Subscriptions" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Cash flow" })).toHaveAttribute(
    "href",
    "/finances/cashflow",
  );
  await userEvent.setup().click(screen.getByRole("link", { name: "Transactions" }));
  expect(onNavigate).toHaveBeenCalledOnce();
});

it("hides an empty review count", () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <TooltipProvider>
          <SidebarProvider>
            <FinanceSidebarNavigation onNavigate={vi.fn()} reviewCount={0} section="overview" />
          </SidebarProvider>
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(screen.queryByRole("link", { name: "Review" })).not.toBeInTheDocument();
});

it("shows connected accounts and separate attention for accounts, profile, and a proposal", async () => {
  const { api } = await import("../../api.js");
  vi.mocked(api.getFinanceConfiguration).mockResolvedValueOnce({
    capabilities: { budget: { state: "ready" } },
    accounts: {
      state: "loaded",
      value: {
        accounts: [
          {
            provider: "plaid",
            status: "connected",
            lastSyncedAt: new Date().toISOString(),
            synchronization: { state: "current" },
          },
          {
            provider: "plaid",
            status: "needs_reauth",
            lastSyncedAt: null,
            synchronization: { state: "blocked" },
          },
          {
            provider: "manual",
            status: "manual",
            lastSyncedAt: null,
            synchronization: { state: "current" },
          },
        ],
      },
    },
    profile: { state: "loaded", value: null },
    budget: { state: "loaded", value: { status: "proposed" } },
  } as never);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <TooltipProvider>
          <SidebarProvider>
            <FinanceSidebarNavigation onNavigate={vi.fn()} reviewCount={0} section="accounts" />
          </SidebarProvider>
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByRole("group", { name: "Accounts: Action required · 3" })).toBeVisible();
  expect(
    screen.getByRole("status", { name: "Financial profile: Action required" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("status", { name: "Budget: Action required" })).toBeInTheDocument();
});

it.each([
  null,
  { status: "draft" },
  { status: "retired" },
  { status: "active" },
])("shows Budget attention until an approved plan is active: %s", async (budget) => {
  const { api } = await import("../../api.js");
  vi.mocked(api.getFinanceConfiguration).mockResolvedValueOnce({
    capabilities: { budget: { state: "ready" } },
    budget: { state: "loaded", value: budget },
  } as never);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <TooltipProvider>
          <SidebarProvider>
            <FinanceSidebarNavigation onNavigate={vi.fn()} reviewCount={0} section="plan" />
          </SidebarProvider>
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await vi.waitFor(() => expect(api.getFinanceConfiguration).toHaveBeenCalled());
  if (budget?.status !== "active")
    expect(await screen.findByRole("status", { name: "Budget: Action required" })).toBeVisible();
  else
    expect(
      screen.queryByRole("status", { name: "Budget: Action required" }),
    ).not.toBeInTheDocument();
});
