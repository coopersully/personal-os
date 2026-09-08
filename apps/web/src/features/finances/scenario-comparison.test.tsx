// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { FinanceScenarioResult } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { FinanceScenarioComparison } from "./scenario-comparison.js";

const api = vi.hoisted(() => ({ compareFinanceScenarios: vi.fn(), getFinanceCategories: vi.fn() }));
vi.mock("../../api.js", () => ({
  api,
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : "Unknown error"),
}));
const categoryId = "11111111-1111-4111-8111-111111111111";
const result: FinanceScenarioResult = {
  asOf: "2026-09-03",
  fingerprint: "test-comparison",
  baseline: {
    label: "Current assumptions",
    monthlyCashFlow: 400,
    projectedLowestBalance: 1000,
    reserveRunwayMonths: 0.8,
    debtPayoffMonths: null,
    goalDateEffects: [],
  },
  alternatives: [
    {
      label: "Alternative",
      monthlyCashFlow: -100,
      projectedLowestBalance: -200,
      reserveRunwayMonths: null,
      debtPayoffMonths: null,
      goalDateEffects: ["Reserve contribution is 500/month higher than Current assumptions."],
    },
  ],
  assumptions: ["Income remains fixed."],
  sensitivityWarnings: ["Returns and irregular costs are not modeled."],
  missingInputs: ["Debt balance is needed to estimate payoff timing."],
  goalConflicts: ["Alternative spends more than its stated monthly income."],
};
beforeEach(() => {
  vi.resetAllMocks();
  api.getFinanceCategories.mockResolvedValue([{ id: categoryId, name: "Groceries" }]);
  api.compareFinanceScenarios.mockResolvedValue(result);
});
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <FinanceScenarioComparison />
    </QueryClientProvider>,
  );
}
async function fillRequired() {
  for (const prefix of ["Baseline", "Alternative 1"]) {
    for (const [label, value] of [
      ["starting cash", "1000"],
      ["monthly income", "2000"],
      ["monthly housing", "1000"],
      ["monthly debt payment", "100"],
      ["monthly reserve contribution", "500"],
    ]) {
      fireEvent.change(screen.getByLabelText(`${prefix} ${label}`), { target: { value } });
    }
    await userEvent.click(
      screen.getByRole("checkbox", { name: `${prefix} has no other monthly spending` }),
    );
  }
}

it("leaves unknown amounts blank and requires explicit expense assumptions", async () => {
  mount();
  expect(screen.getByLabelText("Baseline monthly debt payment")).toHaveValue("");
  expect(screen.getByLabelText("Baseline debt balance (optional)")).toHaveValue("");
  expect(screen.getByRole("button", { name: "Compare scenarios" })).toBeDisabled();
  await fillRequired();
  await userEvent.click(
    screen.getByRole("checkbox", { name: "Baseline has no other monthly spending" }),
  );
  expect(screen.getByRole("button", { name: "Compare scenarios" })).toBeDisabled();
  expect(api.compareFinanceScenarios).not.toHaveBeenCalled();
});

it("submits typed read-only assumptions and shows server projections, missing inputs and warnings", async () => {
  mount();
  await fillRequired();
  fireEvent.change(screen.getByLabelText("Baseline assumptions"), {
    target: { value: "Income remains fixed." },
  });
  fireEvent.change(screen.getByLabelText("As of"), { target: { value: "2026-09-03" } });
  await userEvent.click(screen.getByRole("button", { name: "Compare scenarios" }));
  await waitFor(() =>
    expect(api.compareFinanceScenarios).toHaveBeenCalledWith({
      asOf: "2026-09-03",
      horizonMonths: 12,
      baseline: {
        label: "Current assumptions",
        startingCash: 1000,
        monthlyIncome: 2000,
        monthlyHousingCost: 1000,
        monthlyDebtPayment: 100,
        monthlyReserveContribution: 500,
        budgetAllocations: [],
        assumptions: [
          "Income remains fixed.",
          "Current assumptions: No category spending beyond housing and debt payments.",
        ],
      },
      alternatives: [
        {
          label: "Alternative",
          startingCash: 1000,
          monthlyIncome: 2000,
          monthlyHousingCost: 1000,
          monthlyDebtPayment: 100,
          monthlyReserveContribution: 500,
          budgetAllocations: [],
          assumptions: ["Alternative: No category spending beyond housing and debt payments."],
        },
      ],
    }),
  );
  expect(await screen.findByText("Hypothetical comparison")).toBeInTheDocument();
  expect(screen.getByText("$400.00")).toBeInTheDocument();
  expect(screen.getByText("-$200.00")).toBeInTheDocument();
  expect(screen.getAllByText("Unavailable")).toHaveLength(3);
  for (const message of [
    ...result.missingInputs,
    ...result.sensitivityWarnings,
    ...result.goalConflicts,
    ...result.assumptions,
  ])
    expect(
      within(screen.getByRole("region", { name: "Scenario comparison results" })).getByText(
        message,
      ),
    ).toBeInTheDocument();
  expect(screen.getByText(/Your live plan is unchanged/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Baseline starting cash"), { target: { value: "2000" } });
  expect(screen.getByText("Previous inputs")).toBeInTheDocument();
});

it("uses categorized spending and preserves explicit zero independently from missing optional balances", async () => {
  mount();
  await fillRequired();
  fireEvent.change(screen.getByLabelText("Baseline monthly debt payment"), {
    target: { value: "0" },
  });
  fireEvent.change(screen.getByLabelText("Baseline current goal savings (optional)"), {
    target: { value: "0" },
  });
  await userEvent.click(screen.getByRole("button", { name: "Add baseline spending" }));
  await userEvent.selectOptions(screen.getByLabelText("Baseline spending 1 category"), categoryId);
  fireEvent.change(screen.getByLabelText("Baseline spending 1 amount"), {
    target: { value: "100.25" },
  });
  await userEvent.click(screen.getByRole("button", { name: "Compare scenarios" }));
  await waitFor(() => expect(api.compareFinanceScenarios).toHaveBeenCalled());
  const baseline = api.compareFinanceScenarios.mock.calls[0]?.[0].baseline;
  expect(baseline.monthlyDebtPayment).toBe(0);
  expect(baseline.goalCurrent).toBe(0);
  expect(baseline).not.toHaveProperty("debtBalance");
  expect(baseline).not.toHaveProperty("goalTarget");
  expect(baseline.budgetAllocations).toEqual([{ categoryId, limit: 100.25 }]);
  expect(baseline.assumptions).toEqual([]);
});

it("keeps a failed comparison recoverable and blocks duplicate pending requests", async () => {
  let reject: (error: Error) => void = () => {};
  api.compareFinanceScenarios.mockImplementationOnce(
    () =>
      new Promise((_resolve, onReject) => {
        reject = onReject;
      }),
  );
  mount();
  await fillRequired();
  await userEvent.click(screen.getByRole("button", { name: "Compare scenarios" }));
  expect(screen.getByRole("button", { name: "Comparing…" })).toBeDisabled();
  expect(screen.getByLabelText("Baseline monthly income")).toBeDisabled();
  await act(async () => reject(new Error("Comparison service unavailable")));
  expect(await screen.findByText("Comparison failed")).toBeInTheDocument();
  expect(screen.getByLabelText("Baseline monthly income")).toHaveValue("2000");
  await userEvent.click(screen.getByRole("button", { name: "Compare scenarios" }));
  expect(await screen.findByText("Hypothetical comparison")).toBeInTheDocument();
});

it("rejects a sub-cent amount and exposes duplicate-name validation before calling the API", async () => {
  mount();
  await fillRequired();
  fireEvent.change(screen.getByLabelText("Baseline starting cash"), { target: { value: "1.001" } });
  expect(screen.getByRole("button", { name: "Compare scenarios" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Baseline starting cash"), { target: { value: "-100" } });
  fireEvent.change(screen.getByLabelText("Alternative 1 name"), {
    target: { value: "Current assumptions" },
  });
  await userEvent.click(screen.getByRole("button", { name: "Compare scenarios" }));
  expect(screen.getByText("Give each scenario a different name.")).toBeInTheDocument();
  expect(api.compareFinanceScenarios).not.toHaveBeenCalled();
});
