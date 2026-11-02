// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { WorkspaceBreadcrumbs } from "./workspace-breadcrumbs";

it("links finance pages to their workspace and planning section", () => {
  render(
    <MemoryRouter initialEntries={["/finances/cashflow"]}>
      <WorkspaceBreadcrumbs workspace="finances" />
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: "Finances" })).toHaveAttribute("href", "/finances");
  expect(screen.getByRole("link", { name: "planning" })).toHaveAttribute(
    "href",
    "/finances?navigation=planning",
  );
});
it("does not repeat the current section landing-page title", () => {
  render(
    <MemoryRouter initialEntries={["/tasks?navigation=history"]}>
      <WorkspaceBreadcrumbs workspace="tasks" />
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: "Tasks" })).toHaveAttribute("href", "/tasks");
  expect(screen.queryByRole("link", { name: "history" })).not.toBeInTheDocument();
});
