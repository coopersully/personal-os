// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { BankIcon } from "./icons";
import { KeyMetric, KeyMetrics } from "./key-metrics";

describe("key metrics", () => {
  it("shows a rounded amount while exposing its exact value once to assistive technology", () => {
    render(<KeyMetric label="Cash" value="$23.6k" exactValue="$23,600.00" icon={BankIcon} />);
    const rounded = screen.getByText("$23.6k");
    expect(rounded).toHaveAttribute("aria-hidden", "true");
    expect(screen.getAllByText("$23,600.00")).toHaveLength(1);
    expect(screen.getByText("$23,600.00")).not.toHaveAttribute("aria-hidden", "true");
    expect(rounded.closest("p")).toHaveAttribute("title", "$23,600.00");
    expect(screen.getByText("Cash").querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("does not repeat an already exact amount or require a decorative icon", () => {
    const { container } = render(
      <KeyMetric
        label="Spent this month"
        value="$75.00"
        exactValue="$75.00"
        description="Posted personal expenses"
      />,
    );
    expect(screen.getAllByText("$75.00")).toHaveLength(1);
    expect(screen.getByText("$75.00")).not.toHaveAttribute("aria-hidden");
    expect(container.querySelector("svg")).not.toBeInTheDocument();
    expect(
      screen.getByText("Posted personal expenses").closest('[data-slot="card-header"]'),
    ).toBeInTheDocument();
  });

  it("keeps compact descriptions below the value and renders meaningful nonnumeric states", () => {
    render(
      <KeyMetric
        compact
        label="Cash"
        icon={BankIcon}
        value={<strong>Unavailable</strong>}
        description="Connect an account to see cash"
      />,
    );
    expect(screen.getByText("Unavailable")).toBeVisible();
    expect(screen.getByText("Unavailable").closest("p")).not.toHaveAttribute("title");
    const description = screen.getByText("Connect an account to see cash");
    const content = description.closest('[data-slot="card-content"]');
    expect(content).toBeInTheDocument();
    expect(within(content as HTMLElement).getByText("Unavailable")).toBeVisible();
    expect(
      screen.getByText("Unavailable").compareDocumentPosition(description) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("opens the metric's destination through its keyboard-accessible link", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Routes>
          <Route
            path="/"
            element={<KeyMetric label="Cash" value="$40" to="/finances/accounts" />}
          />
          <Route path="/finances/accounts" element={<h1>Accounts</h1>} />
        </Routes>
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "Cash $40" });
    expect(link).toHaveAttribute("href", "/finances/accounts");
    await user.tab();
    expect(link).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("heading", { name: "Accounts" })).toBeVisible();
  });

  it("makes every grid metric available without carousel navigation", () => {
    render(
      <KeyMetrics layout="grid" label="At a glance">
        <KeyMetric compact label="Spent this month" value="$300" />
        <KeyMetric compact label="Cash" value="$500" />
        <KeyMetric compact label="Upcoming bills" value="$100" />
        <KeyMetric compact label="Unassigned" value="$20" />
      </KeyMetrics>,
    );
    const grid = screen.getByRole("region", { name: "At a glance" });
    for (const label of ["Spent this month", "Cash", "Upcoming bills", "Unassigned"])
      expect(within(grid).getByText(label)).toBeVisible();
    expect(within(grid).queryByRole("button", { name: /previous|next/i })).not.toBeInTheDocument();
    expect(grid.querySelector('[aria-roledescription="carousel"]')).not.toBeInTheDocument();
  });
});
