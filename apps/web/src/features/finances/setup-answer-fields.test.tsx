// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SetupAnswerFields } from "./setup-answer-fields.js";

const api = vi.hoisted(() => ({ listFinanceAccounts: vi.fn(), listFinanceGoals: vi.fn() }));
vi.mock("../../api.js", () => ({ api }));
beforeEach(() => {
  api.listFinanceAccounts.mockResolvedValue({
    accounts: [{ id: "account", kind: "debt", institution: "Test debt" }],
  });
  api.listFinanceGoals.mockResolvedValue({ data: [{ id: "goal", name: "Reserve" }] });
});
function mount(questionId: string, pending = false) {
  const submit = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SetupAnswerFields questionId={questionId} pending={pending} onSubmit={submit} />
    </QueryClientProvider>,
  );
  return submit;
}

it("keeps blank income unknown and accepts explicit zero without fabricated provenance", async () => {
  const submit = mount("planning:recurringIncome");
  await userEvent.click(screen.getByRole("button", { name: "Save answer" }));
  expect(JSON.parse(submit.mock.calls[0]?.[0])).toEqual({ amountCents: null, nextDate: null });
  await userEvent.type(screen.getByLabelText("Reliable monthly take-home (USD)"), "0");
  await userEvent.type(screen.getByLabelText("Next payment date, if known"), "2026-10-01");
  await userEvent.click(screen.getByRole("button", { name: "Save answer" }));
  expect(JSON.parse(submit.mock.lastCall?.[0])).toEqual({ amountCents: 0, nextDate: "2026-10-01" });
});

it("rejects sub-cent income and preserves the entered value", async () => {
  const submit = mount("planning:recurringIncome");
  await userEvent.type(screen.getByLabelText("Reliable monthly take-home (USD)"), "1.001");
  await userEvent.click(screen.getByRole("button", { name: "Save answer" }));
  expect(await screen.findByText(/at most two decimal/)).toBeInTheDocument();
  expect(submit).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Reliable monthly take-home (USD)")).toHaveValue("1.001");
});

it("makes confirmed none explicit and does not turn missing item amounts into zero", async () => {
  const submit = mount("planning:obligations");
  await userEvent.click(screen.getByRole("button", { name: "Confirm none" }));
  expect(submit).toHaveBeenLastCalledWith("[]");
  await userEvent.click(screen.getByRole("button", { name: "Add item" }));
  await userEvent.type(screen.getByLabelText("Name"), "Rent");
  await userEvent.click(screen.getByRole("button", { name: "Save answer" }));
  expect(JSON.parse(submit.mock.lastCall?.[0])).toEqual([
    { id: expect.any(String), name: "Rent", amountCents: null, dueDay: null, debtAccountId: null },
  ]);
  await userEvent.click(screen.getByRole("button", { name: "Remove item 1" }));
  expect(screen.getByRole("button", { name: "Confirm none" })).toBeInTheDocument();
});

it("requires a named linked goal for a planned contribution", async () => {
  const submit = mount("planning:contributions");
  await userEvent.click(screen.getByRole("button", { name: "Add item" }));
  await userEvent.click(screen.getByRole("button", { name: "Save answer" }));
  expect(screen.getByText("Give each item a name.")).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Name"), "Emergency reserve");
  await userEvent.click(screen.getByRole("button", { name: "Save answer" }));
  expect(screen.getByText(/Choose the goal/)).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText("Goal"), "goal");
  await userEvent.type(screen.getByLabelText("Monthly amount (USD), if known"), "100.01");
  await userEvent.type(screen.getByLabelText("Day of month, if known"), "15");
  await userEvent.click(screen.getByRole("button", { name: "Save answer" }));
  expect(JSON.parse(submit.mock.lastCall?.[0])[0]).toMatchObject({
    goalId: "goal",
    amountCents: 10001,
    dueDay: 15,
  });
});

it("records chosen protection and debt minimums without changing balances", async () => {
  const submit = mount("profile:debts");
  await userEvent.click(screen.getByRole("button", { name: "Add item" }));
  await userEvent.type(screen.getByLabelText("Name"), "Card");
  await userEvent.click(screen.getByRole("button", { name: "Save answer" }));
  expect(screen.getByText(/Enter the debt balance/)).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Balance (USD)"), "1000");
  await userEvent.type(screen.getByLabelText("Monthly minimum (USD)"), "25");
  await userEvent.selectOptions(screen.getByLabelText("Debt account, if applicable"), "account");
  await userEvent.click(screen.getByRole("button", { name: "Save answer" }));
  expect(JSON.parse(submit.mock.lastCall?.[0])).toEqual([
    {
      name: "Card",
      accountId: "account",
      balance: 1000,
      minimumMonthlyPayment: 25,
      interestRate: null,
    },
  ]);
});

it("stores a protected quality-of-life priority", async () => {
  const submit = mount("planning:priorities");
  await userEvent.click(screen.getByRole("button", { name: "Add item" }));
  await userEvent.type(screen.getByLabelText("Name"), "Time with friends");
  await userEvent.selectOptions(screen.getByLabelText("Protect this priority"), "true");
  await userEvent.click(screen.getByRole("button", { name: "Save answer" }));
  expect(JSON.parse(submit.mock.lastCall?.[0])[0]).toMatchObject({
    protected: true,
    categoryId: null,
    amountCents: null,
  });
});

it("keeps linked-record failures visible", async () => {
  api.listFinanceGoals.mockRejectedValue(new Error("Unavailable"));
  mount("planning:contributions");
  await waitFor(() =>
    expect(screen.getByText(/Linked records could not load/)).toBeInTheDocument(),
  );
});

it("disables answer changes while saving", () => {
  mount("planning:recurringIncome", true);
  expect(screen.getByLabelText("Reliable monthly take-home (USD)")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Saving answer…" })).toBeDisabled();
});

it("keeps one-time resources tied to their expected date", async () => {
  const submit = mount("planning:exceptionalResources");
  await userEvent.click(screen.getByRole("button", { name: "Add item" }));
  await userEvent.type(screen.getByLabelText("Name"), "Refund");
  await userEvent.type(screen.getByLabelText("Expected amount (USD), if known"), "125.50");
  await userEvent.type(screen.getByLabelText("Expected date, if known"), "2026-11-15");
  await userEvent.click(screen.getByRole("button", { name: "Save answer" }));
  expect(JSON.parse(submit.mock.lastCall?.[0])).toEqual([
    { id: expect.any(String), name: "Refund", amountCents: 12550, expectedDate: "2026-11-15" },
  ]);
});
