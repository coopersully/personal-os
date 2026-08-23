// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { FinanceSidebarNavigation, financeSectionFromPath } from "./navigation.js";

it("maps Finance paths and marks the active navigation item", async () => {
  expect(financeSectionFromPath("/finances")).toBe("overview");
  expect(financeSectionFromPath("/finances/review")).toBe("review");
  expect(financeSectionFromPath("/finances/not-a-section")).toBe("overview");
  const onNavigate = vi.fn();
  render(
    <MemoryRouter>
      <FinanceSidebarNavigation onNavigate={onNavigate} reviewCount={3} section="review" />
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: "Review 3" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/finances");
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
      <FinanceSidebarNavigation onNavigate={vi.fn()} reviewCount={0} section="overview" />
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: "Review" })).not.toHaveTextContent("0");
});
