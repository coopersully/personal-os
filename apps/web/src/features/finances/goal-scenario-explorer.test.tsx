// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { FinanceGoalScenarioExplorer } from "./goal-scenario-explorer.js";

const feedback = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("sonner", () => ({ toast: feedback }));
beforeEach(() => vi.clearAllMocks());

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
function inputs() {
  fill("Hypothetical target amount", "10.00");
  fill("Currency code (two minor-unit digits)", "USD");
  fill("Baseline monthly contribution", "4");
}
function compare() {
  fireEvent.click(screen.getByRole("button", { name: "Compare hypothetical contributions" }));
}

it("requires user-chosen dates and does not infer saved progress or currency", () => {
  render(<FinanceGoalScenarioExplorer />);
  expect(screen.getByLabelText("Currency code (two minor-unit digits)")).toHaveValue("");
  expect(screen.getByLabelText("Hypothetical current amount (blank means unknown)")).toHaveValue(
    "",
  );
  expect(screen.getByLabelText("Projection as-of local date")).toHaveValue("");
  inputs();
  compare();
  expect(feedback.error).toHaveBeenCalled();
  expect(screen.queryByLabelText("Hypothetical goal results")).not.toBeInTheDocument();
});

it("distinguishes unknown and confirmed zero and shows anchored exact hypothetical curves", () => {
  render(<FinanceGoalScenarioExplorer asOfLocalDate="2027-01-31" />);
  inputs();
  fill("Hypothetical current amount (blank means unknown)", "0");
  compare();
  expect(screen.getByText(/Progress unknown. Enter an amount/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox"));
  compare();
  const baseline = screen.getByRole("region", { name: "Hypothetical Baseline" });
  expect(within(baseline).getByText("Hypothetical completion: 2027-03-31")).toBeInTheDocument();
  fireEvent.click(within(baseline).getByText("Hypothetical dated contribution curve for Baseline"));
  expect(within(baseline).getByRole("cell", { name: "2027-02-28" })).toBeInTheDocument();
  expect(within(baseline).getByRole("cell", { name: "2027-03-31" })).toBeInTheDocument();
  expect(screen.getByText(/Zero interest or growth/)).toBeInTheDocument();
  fill("Hypothetical current amount (blank means unknown)", "1");
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(screen.queryByLabelText("Hypothetical goal results")).not.toBeInTheDocument();
});

it("compares up to three named alternatives with honest no-completion and target-date outcomes", () => {
  render(<FinanceGoalScenarioExplorer asOfLocalDate="2027-01-31" />);
  inputs();
  fill("Hypothetical target amount", "20");
  fill("Hypothetical current amount (blank means unknown)", "0");
  fireEvent.click(screen.getByRole("checkbox"));
  for (let i = 1; i <= 3; i++)
    fireEvent.click(screen.getByRole("button", { name: "Add hypothetical alternative" }));
  expect(screen.getByRole("button", { name: "Add hypothetical alternative" })).toBeDisabled();
  fill("Alternative 1 name", "Pause");
  fill("Alternative 1 monthly contribution", "0");
  fill("Alternative 2 monthly contribution", "-1");
  fill("Alternative 3 monthly contribution", "0.01");
  fill("Optional target local date", "2027-01-30");
  compare();
  expect(
    within(screen.getByRole("region", { name: "Hypothetical Pause" })).getByText(
      /monthly contribution is zero or negative/,
    ),
  ).toBeInTheDocument();
  expect(screen.getByText(/Target date is in the past/)).toBeInTheDocument();
  expect(screen.getByText(/No completion within the 1200-month horizon/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Remove alternative 2" }));
  expect(screen.getByRole("button", { name: "Add hypothetical alternative" })).toBeEnabled();
});

it("reports invalid cents and unsupported currency through Sonner and permits corrections", () => {
  render(<FinanceGoalScenarioExplorer asOfLocalDate="2027-01-31" />);
  inputs();
  fill("Hypothetical target amount", "1.001");
  compare();
  expect(feedback.error).toHaveBeenLastCalledWith(
    "Enter each amount with at most two decimal places.",
  );
  fill("Hypothetical target amount", "10");
  fill("Currency code (two minor-unit digits)", "JPY");
  compare();
  expect(feedback.error).toHaveBeenLastCalledWith(expect.stringContaining("two minor-unit digits"));
  fill("Currency code (two minor-unit digits)", "USD");
  fill("Hypothetical current amount (blank means unknown)", "10");
  fireEvent.click(screen.getByRole("checkbox"));
  compare();
  expect(screen.getByText("Already achieved under these hypothetical inputs.")).toBeInTheDocument();
});
