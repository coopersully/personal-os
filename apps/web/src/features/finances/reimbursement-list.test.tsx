// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { ApiClientError } from "@personal-os/api-client";
import type { FinanceReimbursement } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FinanceReimbursementList } from "./reimbursement-list";

const api = vi.hoisted(() => ({
  listFinanceReimbursements: vi.fn(),
  reconcileFinanceReimbursement: vi.fn(),
}));
vi.mock("../../api.js", () => ({ api }));
const id = "11111111-1111-4111-8111-111111111111",
  tx = "22222222-2222-4222-8222-222222222222";
const evidence = {
  summary: "Expense source",
  sourceRefs: [
    {
      provider: "local" as const,
      sourceType: "finance_transaction" as const,
      remoteId: tx,
      revision: "1",
      accountId: null,
    },
  ],
};
function claim(changes: Partial<FinanceReimbursement> = {}): FinanceReimbursement {
  return {
    id,
    allocationId: tx,
    payer: "Casey",
    expectedAmount: 120,
    receivedAmount: 40,
    status: "partially_received",
    revision: 2,
    dueDate: null,
    rationale: "Shared expense",
    evidence,
    createdAt: "2026-10-18T12:00:00Z",
    updatedAt: "2026-10-18T12:00:00Z",
    cancelledAt: null,
    cancelledEvidence: null,
    cancelledRationale: null,
    matches: [],
    ...changes,
  };
}
function show(item = claim()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.listFinanceReimbursements.mockResolvedValue({ reimbursements: [item], unmatchedCredits: [] });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <FinanceReimbursementList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
beforeEach(() => vi.resetAllMocks());
it.each([
  401, 403,
])("hides cached private journey and dismisses its open correction after denial %s", async (status) => {
  const client = show();
  fireEvent.click(await screen.findByRole("button", { name: "Correct expectation" }));
  expect(screen.getByRole("dialog")).toBeVisible();
  api.listFinanceReimbursements.mockRejectedValue(
    new ApiClientError({ status, code: "forbidden", message: "Denied" }),
  );
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["finance-reimbursements"] });
  });
  expect(await screen.findByText(/Reimbursement access unavailable/)).toBeVisible();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByText("Casey")).not.toBeInTheDocument();
  expect(client.getQueryData(["finance-reimbursements"])).toMatchObject({
    reimbursements: [{ id }],
  });
});
it("retains the cached journey during a transient refresh failure", async () => {
  const client = show();
  expect(await screen.findByText("Casey")).toBeVisible();
  api.listFinanceReimbursements.mockRejectedValue(new Error("Network unavailable"));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["finance-reimbursements"] });
  });
  expect(screen.getByText("Casey")).toBeVisible();
  expect(screen.getByRole("button", { name: "Correct expectation" })).toBeVisible();
});
it("uses verified transaction currency and never inserts a USD fallback", async () => {
  show();
  expect(
    await screen.findByText(/40.00 \(currency unknown\) received of 120.00 \(currency unknown\)/),
  ).toBeVisible();
  expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
});
it("shows canonical source currency and warns about mismatched credit currency", async () => {
  const item = claim({
    sourceExpense: {
      transactionId: tx,
      amount: 200,
      allocationAmount: 120,
      allocationRevision: 1,
      allocationState: "active",
      allocationTreatment: "reimbursable",
      date: "2026-10-01",
      merchant: "Expense",
      currency: "EUR",
      pending: false,
    },
  });
  item.matches = [
    {
      id: tx,
      reimbursementId: id,
      creditTransactionId: tx,
      amount: 40,
      createdAt: item.createdAt,
      rationale: "Receipt",
      evidence,
      creditTransaction: {
        transactionId: tx,
        amount: 40,
        currency: "USD",
        date: "2026-10-02",
        merchant: "Credit",
        pending: false,
      },
    },
  ];
  show(item);
  expect(await screen.findByText(/€40.00 received of €120.00/)).toBeVisible();
  expect(screen.getByText(/Receipt currency differs from the source expense/)).toBeVisible();
});

it("labels qualified personal cost as whole-expense material and never adds case cards", async () => {
  const item = claim({
    sourceExpense: {
      transactionId: tx,
      amount: 200,
      allocationAmount: 120,
      allocationRevision: 1,
      allocationState: "active",
      allocationTreatment: "reimbursable",
      date: "2026-10-01",
      merchant: "Expense",
      currency: "EUR",
      pending: false,
      personalCostToDate: {
        state: "qualified",
        amount: 150,
        receivedAmount: 50,
        currency: "EUR",
        scope: "whole_expense",
      },
    },
  });
  show(item);
  expect(
    await screen.findByText(
      /Personal cost to date \(whole expense\): €150.00. May repeat on related claims; do not add case cards together/,
    ),
  ).toBeVisible();
  expect(screen.queryByText(/€100.00/)).not.toBeInTheDocument();
});

it.each([
  401, 403,
])("hides every cached private card after an actual correction mutation denies access %s", async (status) => {
  const item = claim({
    sourceExpense: {
      transactionId: tx,
      amount: 200,
      allocationAmount: 120,
      allocationRevision: 1,
      allocationState: "active",
      allocationTreatment: "reimbursable",
      date: "2026-10-01",
      merchant: "Private expense",
      currency: "EUR",
      pending: false,
      personalCostToDate: {
        state: "qualified",
        amount: 150,
        receivedAmount: 50,
        currency: "EUR",
        scope: "whole_expense",
      },
    },
  });
  const client = show(item);
  expect(await screen.findByText("Casey")).toBeVisible();
  await act(async () => {
    client.setQueryData(["finance-reimbursements"], {
      reimbursements: [
        item,
        {
          ...claim(),
          id: "33333333-3333-4333-8333-333333333333",
          payer: "Robin private",
          rationale: "Other private claim",
        },
      ],
      unmatchedCredits: [],
    });
  });
  const action = screen.getAllByRole("button", { name: "Correct expectation" })[0];
  if (!action) throw new Error("Correction action missing");
  fireEvent.click(action);
  fireEvent.change(screen.getByLabelText("Reason for correction"), {
    target: { value: "Correct shared amount" },
  });
  fireEvent.change(screen.getByLabelText("Supporting evidence"), {
    target: { value: "Payer confirmed correction" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  api.reconcileFinanceReimbursement.mockRejectedValue(
    new ApiClientError({ status, code: "forbidden", message: "Denied" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
  expect(await screen.findByText(/Reimbursement access unavailable/)).toBeVisible();
  expect(api.reconcileFinanceReimbursement).toHaveBeenCalledWith(
    expect.objectContaining({
      operation: "correct_expected",
      reimbursementId: id,
      expectedRevision: 2,
    }),
  );
  expect(screen.queryByText("Casey")).not.toBeInTheDocument();
  expect(screen.queryByText("Robin private")).not.toBeInTheDocument();
  expect(screen.queryByText(/Other private claim/)).not.toBeInTheDocument();
  expect(screen.queryByText(/€150.00/)).not.toBeInTheDocument();
  expect(screen.queryByText(/€40.00 received/)).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByRole("list")).not.toBeInTheDocument();
  expect(client.getQueryData(["finance-reimbursements"])).toMatchObject({
    reimbursements: [{ id }, { payer: "Robin private" }],
  });
});
it("retains the private list and exact retry controls after a transient correction failure", async () => {
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Correct expectation" }));
  fireEvent.change(screen.getByLabelText("Reason for correction"), {
    target: { value: "Correct shared amount" },
  });
  fireEvent.change(screen.getByLabelText("Supporting evidence"), {
    target: { value: "Payer confirmed correction" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  api.reconcileFinanceReimbursement.mockRejectedValue(new Error("Network unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
  expect(await screen.findByRole("button", { name: "Retry same correction" })).toBeEnabled();
  expect(screen.getByText("Casey")).toBeVisible();
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(screen.getByLabelText("Expected amount")).toBeDisabled();
});
