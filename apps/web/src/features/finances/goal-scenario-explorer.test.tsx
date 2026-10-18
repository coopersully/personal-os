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

it("distinguishes unknown and confirmed zero and shows anchored exact hypothetical curves", async () => {
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
  expect(await within(baseline).findByRole("cell", { name: "2027-02-28" })).toBeInTheDocument();
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
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Enter each amount with at most two decimal places.",
  );
  fill("Hypothetical target amount", "10");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  fill("Currency code (two minor-unit digits)", "JPY");
  compare();
  expect(feedback.error).toHaveBeenLastCalledWith(expect.stringContaining("two minor-unit digits"));
  fill("Currency code (two minor-unit digits)", "USD");
  fill("Hypothetical current amount (blank means unknown)", "10");
  fireEvent.click(screen.getByRole("checkbox"));
  compare();
  expect(screen.getByText("Already achieved under these hypothetical inputs.")).toBeInTheDocument();
});

it("lazily renders at most 24 curve points and preserves access to the final horizon month", async () => {
  render(<FinanceGoalScenarioExplorer asOfLocalDate="2027-01-31" />);
  inputs();
  fill("Hypothetical target amount", "20");
  fill("Baseline monthly contribution", "0.01");
  fill("Hypothetical current amount (blank means unknown)", "0");
  fireEvent.click(screen.getByRole("checkbox"));
  for (let i = 1; i <= 3; i++) {
    fireEvent.click(screen.getByRole("button", { name: "Add hypothetical alternative" }));
    fill(`Alternative ${i} monthly contribution`, "0.01");
  }
  compare();
  expect(screen.queryByRole("table", { hidden: true })).not.toBeInTheDocument();
  const baseline = screen.getByRole("region", { name: "Hypothetical Baseline" });
  fireEvent.click(within(baseline).getByText("Hypothetical dated contribution curve for Baseline"));
  const table = await within(baseline).findByRole("table");
  expect(within(table).getAllByRole("row")).toHaveLength(25);
  expect(screen.getAllByRole("table", { hidden: true })).toHaveLength(1);
  expect(
    within(baseline).getByText("Contributions 1–24 of 1200 · Page 1 of 50"),
  ).toBeInTheDocument();
  expect(
    within(baseline).getByRole("button", { name: "Previous contributions for Baseline" }),
  ).toBeDisabled();
  fireEvent.click(
    within(baseline).getByRole("button", { name: "Next contributions for Baseline" }),
  );
  expect(within(table).getByRole("cell", { name: "2029-01-31" })).toBeInTheDocument();
  fireEvent.click(
    within(baseline).getByRole("button", { name: "Last contributions for Baseline" }),
  );
  expect(
    within(baseline).getByText("Contributions 1177–1200 of 1200 · Page 50 of 50"),
  ).toBeInTheDocument();
  expect(within(table).getByRole("cell", { name: "2126-12-31" })).toBeInTheDocument();
  expect(
    within(baseline).getByRole("button", { name: "Next contributions for Baseline" }),
  ).toBeDisabled();
  fireEvent.click(
    within(baseline).getByRole("button", { name: "Previous contributions for Baseline" }),
  );
  expect(
    within(baseline).getByText("Contributions 1153–1176 of 1200 · Page 49 of 50"),
  ).toBeInTheDocument();
});

it("uses only applicable saved evidence, preserves provenance and never asks for redundant session confirmation", async () => {
  const ownerUserId = "11111111-1111-4111-8111-111111111111";
  const goal = {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Saved reserve",
    version: 3,
    currentAmount: 0,
    targetAmount: 10,
    status: "active" as const,
    priority: "high" as const,
    deadline: null,
    createdAt: "2027-01-30T12:00:00Z",
    updatedAt: "2027-01-30T12:00:00Z",
    planningEvidence: {
      kind: "goal" as const,
      evidenceId: "33333333-3333-4333-8333-333333333333",
      ownerUserId,
      actor: { type: "user" as const, userId: ownerUserId },
      provenance: "explicit_user" as const,
      currencyCode: "EUR",
      asOf: "2027-01-30",
      recordedAt: "2027-01-30T12:00:00Z",
      goalId: "22222222-2222-4222-8222-222222222222",
      goalVersion: 3,
      progressAmountCents: 0,
    },
  };
  const reconfirm = vi.fn();
  const { rerender } = render(
    <FinanceGoalScenarioExplorer
      connectedGoal={{ goal, ownerUserId, todayLocalDate: "2027-01-31" }}
      onConfirmProgress={reconfirm}
    />,
  );
  expect(
    screen.getByText(/Confirmed by you as of 2027-01-30 · EUR · Goal version 3/),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Confirmed goal progress")).toHaveValue("0");
  expect(screen.getByLabelText("Confirmed goal currency")).toHaveValue("EUR");
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  fill("Baseline monthly contribution", "4");
  compare();
  expect(screen.getByText("Hypothetical completion: 2027-03-31")).toBeInTheDocument();
  rerender(
    <FinanceGoalScenarioExplorer
      connectedGoal={{ goal: { ...goal, version: 4 }, ownerUserId, todayLocalDate: "2027-01-31" }}
      onConfirmProgress={reconfirm}
    />,
  );
  expect(
    screen.getByText(/Current progress and currency are unknown for this goal version/),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText("Hypothetical goal results")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Compare hypothetical contributions" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Confirm saved progress" }));
  expect(reconfirm).toHaveBeenCalledOnce();
});
