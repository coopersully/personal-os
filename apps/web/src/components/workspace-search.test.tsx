// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { WorkspaceSearch } from "./workspace-search.js";

describe("WorkspaceSearch", () => {
  it("keeps the search term in the linkable q parameter", async () => {
    const browser = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/tasks?view=next"]}>
        <WorkspaceSearch label="Search tasks" />
        <CurrentSearch />
      </MemoryRouter>,
    );

    const search = screen.getByRole("searchbox", { name: "Search tasks" });
    await browser.type(search, "weekly brief");
    expect(screen.getByTestId("location-search")).toHaveTextContent("?view=next&q=weekly+brief");
    expect(search).toHaveValue("weekly brief");

    await browser.clear(search);
    expect(screen.getByTestId("location-search")).toHaveTextContent("?view=next");
  });
});

function CurrentSearch() {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
}
