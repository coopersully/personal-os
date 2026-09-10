// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import { FinanceSidebarNavigation, financeSectionFromPath } from "./navigation.js";

it("maps Finance paths and marks the active navigation item", async () => {
  expect(financeSectionFromPath("/finances")).toBe("overview");
  expect(financeSectionFromPath("/finances/review")).toBe("review");
  expect(financeSectionFromPath("/finances/budgets")).toBe("plan");
  expect(financeSectionFromPath("/finances/wealth")).toBe("wealth");
  expect(financeSectionFromPath("/finances/setup")).toBe("setup");
  expect(financeSectionFromPath("/finances/not-a-section")).toBe("overview");
  const onNavigate = vi.fn();
  render(
    <MemoryRouter>
      <SidebarProvider>
        <FinanceSidebarNavigation onNavigate={onNavigate} reviewCount={3} section="review" />
      </SidebarProvider>
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: "Review 3" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Review 3" })).toHaveAttribute(
    "data-slot",
    "sidebar-menu-button",
  );
  expect(screen.getByRole("link", { name: "Review 3" })).toHaveAttribute("data-active", "true");
  expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/finances");
  expect(screen.getByRole("link", { name: "Plan" })).toHaveAttribute("href", "/finances/plan");
  expect(screen.getByRole("link", { name: "Wealth" })).toHaveAttribute("href", "/finances/wealth");
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
    <MemoryRouter>
      <SidebarProvider>
        <FinanceSidebarNavigation onNavigate={vi.fn()} reviewCount={0} section="overview" />
      </SidebarProvider>
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: "Review" })).not.toHaveTextContent("0");
});
